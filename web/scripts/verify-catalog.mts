import path from "node:path";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* The catalog against a real database: what happens to servers when a
   game's versions change underneath them.

   Written the day Project Zomboid's build 42 went stable and took the
   public branch with it. Every assumption the catalog had made about
   Zomboid became false at once — which version was stable, which branch
   carried which build, which id meant what — and the unit tests could
   not see what that did to rows that already existed. This can. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { storedCatalog } = await import("../src/lib/catalog-read");
const { updateOfferFor } = await import("../src/lib/update-ops");
const { updateServerConfigOp } = await import("../src/lib/config-ops");
const { validateCreate } = await import("../src/lib/create-ops");
const { outlookFor } = await import("../src/domain/games/versions");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};

const ZOMBOID = "project-zomboid";
const row = (gameId: string, slug: string) =>
  db.gameVersion.findUnique({ where: { gameId_slug: { gameId, slug } } });
const server = (slug: string) =>
  db.server.findUniqueOrThrow({ where: { slug }, include: { gameVersionRef: { select: { slug: true } } } });

try {
  await seed();
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });

  /* ── Linking ─────────────────────────────────────────────────────── */
  console.log("\n== servers that predate the catalog link to the right software ==");
  check("1.21.4 · Paper links to Paper", (await server("aurora")).gameVersionRef?.slug === "paper-1-21-4");
  check(
    "1.21.4 · Fabric links to Fabric, not whichever 1.21.4 came first",
    (await server("creative")).gameVersionRef?.slug === "fabric-1-21-4",
    String((await server("creative")).gameVersionRef?.slug),
  );
  /* The only 1.20.6 in the catalog is Paper. Linking a Purpur server to
     it would offer that server Paper updates. */
  check(
    "1.20.6 · Purpur links to nothing rather than to Paper",
    (await server("nightfall")).gameVersionId === null,
    String((await server("nightfall")).gameVersionRef?.slug),
  );

  /* ── Offers ──────────────────────────────────────────────────────── */
  console.log("\n== an update is offered within a line and nowhere else ==");
  // The newest Paper that Paper calls stable — not 26.3, whose builds are alpha.
  check(
    "Paper 1.21.4 is offered Paper 26.2, and not the preview past it",
    (await updateOfferFor(await server("aurora"))).targetVersionId === "paper-26-2",
    String((await updateOfferFor(await server("aurora"))).targetVersionId),
  );
  check(
    "Fabric 1.21.4 is not offered Paper, however much newer",
    (await updateOfferFor(await server("creative"))).targetVersionId === null,
  );

  const paperOld = (await row("minecraft-java", "paper-1-20-6"))!;
  await db.server.update({ where: { slug: "aurora" }, data: { gameVersionId: paperOld.id } });
  check(
    "Paper 1.20.6 is offered the same one, skipping the versions between",
    (await updateOfferFor(await server("aurora"))).targetVersionId === "paper-26-2",
    String((await updateOfferFor(await server("aurora"))).targetVersionId),
  );

  /* ── Renaming ────────────────────────────────────────────────────── */
  console.log("\n== a renamed version keeps the servers linked to it ==");

  // The catalog as the old definition left it, public's build id and all.
  const b41 = (await row(ZOMBOID, "b41"))!;
  await db.gameVersion.update({
    where: { id: b41.id },
    data: { slug: "b41-stable", label: "Build 41 · stable", branch: "public", buildId: "24909836" },
  });
  // And a server created on it.
  await db.server.update({
    where: { slug: "nightfall" },
    data: {
      gameId: ZOMBOID,
      game: "Project Zomboid",
      gameVersionId: b41.id,
      version: "Build 41 · stable",
    },
  });
  // A build id the next sync cannot refresh, on a version still on its branch.
  const b42 = (await row(ZOMBOID, "b42"))!;
  await db.gameVersion.update({ where: { id: b42.id }, data: { branch: "public", buildId: "24909836" } });

  const report = await syncCatalog({ offline: true });
  check("the sync reports the rename", report.renamed === 1, String(report.renamed));

  const moved = await row(ZOMBOID, "b41");
  check("the row moved rather than being recreated", moved?.id === b41.id);
  check("nothing is left under the old id", (await row(ZOMBOID, "b41-stable")) === null);
  check("the server is still linked to it", (await server("nightfall")).gameVersionId === b41.id);
  check("and relabelled from the definition", moved?.label === "Build 41");
  check(
    "public's build id is not left on a version that tracks legacy41",
    moved?.buildId === null && moved?.branch === null,
    `${moved?.branch}@${moved?.buildId}`,
  );
  /* Offline, nobody asked Steam. A build id that still belongs to the
     branch its version tracks is the best there is until somebody does. */
  check(
    "a build id an offline sync cannot refresh is kept",
    (await row(ZOMBOID, "b42"))?.buildId === "24909836",
  );

  console.log("\n== a rename that finds both rows merges them ==");
  const stray = await db.gameVersion.create({
    data: { gameId: ZOMBOID, slug: "b41-stable", label: "Build 41 · stable", source: "" },
  });
  await db.server.update({ where: { slug: "nightfall" }, data: { gameVersionId: stray.id } });
  await syncCatalog({ offline: true });
  check("the server moved to the surviving row", (await server("nightfall")).gameVersionId === b41.id);
  check("and the stray is gone", (await db.gameVersion.findUnique({ where: { id: stray.id } })) === null);

  /* ── Zomboid ─────────────────────────────────────────────────────── */
  console.log("\n== a build 41 server is told about build 42, and not offered it ==");
  const catalog = (await storedCatalog(ZOMBOID))!;
  check("build 42 is the recommendation", catalog.recommended?.id === "b42", String(catalog.recommended?.id));

  const outlook = outlookFor(catalog, { versionId: "b41" });
  check("no update is available", outlook.updateAvailable === false);
  check("build 42 is reported as a newer line", outlook.newerLine?.id === "b42", JSON.stringify(outlook.newerLine));
  check("the button offers nothing", (await updateOfferFor(await server("nightfall"))).targetVersionId === null);

  const refused = validateCreate({
    name: "Knox Event",
    host: "knox.ashfold.gg",
    gameId: ZOMBOID,
    versionId: "b42-unstable",
    templateId: "survival",
    nodeName: "ash-node-01",
    memoryGb: 8,
    cpuLimit: 300,
    diskGb: 30,
  } as Parameters<typeof validateCreate>[0]);
  check("a new server on the gone unstable branch is refused", refused?.includes("no longer installs") === true, String(refused));

  /* ── Rebuilding ──────────────────────────────────────────────────── */
  console.log("\n== a rebuild with no version to install from is refused ==");
  /* A Minecraft server whose stored label matches no version. The old
     rebuild fell back to the definition's first version, and would have
     reinstalled a Purpur 1.20.6 world as Paper 1.21.4. */
  await db.server.update({
    where: { slug: "nightfall" },
    data: { gameId: "minecraft-java", game: "Minecraft", gameVersionId: null, version: "1.20.6 · Purpur" },
  });
  const before = (await server("nightfall")).config;
  const r = await updateServerConfigOp(mara, "nightfall", { maxPlayers: 31 }, { recreate: true });
  check("the rebuild is refused", !r.ok && r.title === "Cannot rebuild this server", JSON.stringify(r));
  check("and the settings were not written", JSON.stringify((await server("nightfall")).config) === JSON.stringify(before));
} finally {
  // Leave the fixture as the next script expects to find it.
  await seed().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
