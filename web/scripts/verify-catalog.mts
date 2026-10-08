import "./load-env.mts";
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

  /* ── A release the image's registry lists ────────────────────────────
     Written the day 42.21 was out and a server on 42.20.4 stayed there: Steam had moved, so the panel said "update available", and no
     version named the tag that carries it. Docker Hub is stubbed (what it answers is not what is under test); everything after it is
     the real thing — the rows, the offer, the readback by a process that was not the one that asked. */
  console.log("\n== a release the registry lists is a version, in the catalog, and an update ==");
  const realFetch = globalThis.fetch;
  let hubStatus = 200;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    if (hubStatus !== 200) return new Response("{}", { status: hubStatus });
    return new Response(
      JSON.stringify({
        results: [
          { name: "latest-release", last_updated: "2026-10-01T12:25:07Z", tag_status: "active" },
          { name: "42.21-release-2", last_updated: "2026-10-01T12:25:05Z", tag_status: "active" },
          { name: "42.21-release", last_updated: "2026-09-29T12:08:54Z", tag_status: "active" },
          { name: "42.21-unstable", last_updated: "2026-09-23T21:07:42Z", tag_status: "active" },
          { name: "42.20.4-release", last_updated: "2026-08-26T12:49:36Z", tag_status: "active" },
          { name: "41.78.19-release", last_updated: "2026-04-09T02:07:24Z", tag_status: "active" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const { refreshFollowedVersions, loadFollowedVersions } = await import("../src/lib/followed-versions");
  const { setFollowedVersions, requireGame } = await import("../src/domain/games/registry");
  try {
    const found = await refreshFollowedVersions({ refresh: true });
    check("the registry is asked once, for the repository the definition names", asked.length === 1 && asked[0]!.includes("/danixu86/project-zomboid-dedicated-server/tags"), asked.join(" "));
    check("one version is found, and it is 42.21 on its second build", found.held === 1 && found.errors.length === 0, JSON.stringify(found));
    await syncCatalog({ offline: true });

    const added = await row(ZOMBOID, "b42-42-21");
    check("it has a row, from the registry", added?.origin === "REGISTRY" && added.source === "danixu86/project-zomboid-dedicated-server:42.21-release-2", `${added?.origin} ${added?.source}`);
    check("installable, and what a new server starts on", added?.supported === true && added.recommended === true);
    check("and 42.20.4 is not recommended any more", (await row(ZOMBOID, "b42"))?.recommended === false);

    const b42Row = (await row(ZOMBOID, "b42"))!;
    await db.server.update({ where: { slug: "nightfall" }, data: { gameId: ZOMBOID, game: "Project Zomboid", gameVersionId: b42Row.id, version: "Build 42" } });
    const offer = await updateOfferFor(await server("nightfall"));
    check("a server on 42.20.4 is offered 42.21", offer.targetVersionId === "b42-42-21", JSON.stringify(offer));
    await db.server.update({ where: { slug: "nightfall" }, data: { gameVersionId: b41.id, version: "Build 41" } });
    check("a build 41 server is offered nothing", (await updateOfferFor(await server("nightfall"))).targetVersionId === null);

    const created = validateCreate({
      name: "Knox Event",
      host: "knox.ashfold.gg",
      gameId: ZOMBOID,
      versionId: "b42-42-21",
      templateId: "survival",
      nodeName: "ash-node-01",
      memoryGb: 8,
      cpuLimit: 300,
      diskGb: 30,
    } as Parameters<typeof validateCreate>[0]);
    check("a new server may be made on it", created === null, String(created));

    /* The panel is another process, and starts without the registry. It reads the rows back. */
    setFollowedVersions({});
    check("a process that has not read the catalog does not know it", !requireGame(ZOMBOID).versions.some((v) => v.id === "b42-42-21"));
    const read = await loadFollowedVersions();
    check("and reads it back from the rows, asking nobody", read.held === 1 && asked.length === 1, JSON.stringify(read));
    check("as the version it was", requireGame(ZOMBOID).versions.find((v) => v.id === "b42-42-21")?.image === "danixu86/project-zomboid-dedicated-server:42.21-release-2");

    /* The registry down is a message, and takes nothing away: a server on 42.21 must still be known to the panel. */
    hubStatus = 503;
    const down = await refreshFollowedVersions({ refresh: true });
    check("a registry that does not answer is reported", down.errors.length === 1 && /503/.test(down.errors[0]!.message), JSON.stringify(down.errors));
    check("and the version stays", down.held === 1 && requireGame(ZOMBOID).versions.some((v) => v.id === "b42-42-21"));
  } finally {
    globalThis.fetch = realFetch;
    setFollowedVersions({});
    await db.server.update({ where: { slug: "nightfall" }, data: { gameVersionId: b41.id, version: "Build 41" } });
    await db.gameVersion.deleteMany({ where: { origin: "REGISTRY" } });
    await db.gameVersion.update({ where: { id: (await row(ZOMBOID, "b42"))!.id }, data: { recommended: true } });
  }

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
