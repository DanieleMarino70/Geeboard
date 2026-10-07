import "./load-env.mts";
import process from "node:process";

/* Adding a game, a version, a secret or a node, and what the panel does before anybody has told it.

   A server is linked to its game's definition through the catalog, and the command that stops it, the one that saves it before a backup, its
   health check and its settings are all found through that link. The catalog was brought up to the definitions only when the poller's six-hour
   clock ran out, so after a release that adds a game or a version the first servers made were born without any of it. And a node that reports
   an architecture no game accepts (armv7l, riscv64) was read as "has not reported one yet" and let through to fail at the image pull. This
   is the panel's side of both, on the verification database. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { createServerOp } = await import("../src/lib/create-ops");
const { catalogGaps, syncCatalog } = await import("../src/lib/catalog-sync");
const { findGame } = await import("../src/domain/games/registry");
const { games, defaultVersion, gameForVersion } = await import("../src/lib/catalog");
const { applyTemplate } = await import("../src/domain/games/config");

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

await seed();
const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
const terraria = games().find((g) => g.id === "terraria")!;
const version = defaultVersion(terraria);
const template = terraria.templates[0]!;
const input = (name: string, host: string) => ({
  name,
  host,
  gameId: terraria.id,
  versionId: version.id,
  templateId: template.id,
  config: applyTemplate(gameForVersion(terraria, version.id), template.id),
  nodeName: "fra-node-02",
  memoryGb: terraria.defaults.memoryGb,
  cpuLimit: 100,
  diskGb: terraria.defaults.diskGb,
});

console.log("\n== a version the catalog has not got ==");
check("the catalog is complete after a seed", (await catalogGaps()) === 0, String(await catalogGaps()));
await db.gameVersion.deleteMany({ where: { gameId: "terraria" } });
const missingVersions = await catalogGaps();
check(`take Terraria's versions away: ${missingVersions} rows are missing`, missingVersions >= terraria.versions.length, String(missingVersions));
const a = await createServerOp(mara, input("Born Linked A", "born-a.example.com"));
check("a server is created anyway", a.ok, `${a.title}: ${a.body}`);
const rowA = await db.server.findFirst({ where: { name: "Born Linked A" } });
check("and it has its game and its version: it was born linked", rowA?.gameId === "terraria" && rowA?.gameVersionId !== null, JSON.stringify({ gameId: rowA?.gameId, gameVersionId: rowA?.gameVersionId }));
check("so its stop goes through the game's own command, not a signal", Boolean(findGame(rowA?.gameId ?? "")?.console.stopCommand), String(findGame(rowA?.gameId ?? "")?.console.stopCommand));
check("and the catalog is complete again", (await catalogGaps()) === 0, String(await catalogGaps()));

console.log("\n== a game the catalog has not got ==");
await db.game.delete({ where: { id: "terraria" } });
check("take the game itself away", (await catalogGaps()) > terraria.versions.length);
const b = await createServerOp(mara, input("Born Linked B", "born-b.example.com"));
const rowB = await db.server.findFirst({ where: { name: "Born Linked B" } });
check("a server made now is linked too", b.ok && rowB?.gameId === "terraria" && rowB?.gameVersionId !== null, `${b.title}: ${b.body}`);

console.log("\n== the poller closes the gap whatever the age of the last sync ==");
await db.game.delete({ where: { id: "minecraft-java" } });
check("a game is missing", (await catalogGaps()) > 0);
await syncCatalog({ offline: true });
check("an offline pass from the definitions adds it back, with no network", (await catalogGaps()) === 0, String(await catalogGaps()));

console.log("\n== a node that reports a platform no game accepts ==");
for (const [os, arch] of [["linux", "armv7l"], ["linux", "riscv64"], ["freebsd", "x64"]] as const) {
  await db.node.update({ where: { name: "fra-node-02" }, data: { os, arch } });
  const refused = await createServerOp(mara, input(`On ${os} ${arch}`, `${arch}.example.com`));
  const said = `${refused.title} ${refused.body}`;
  check(`${os}/${arch} is refused, by name`, !refused.ok && new RegExp(`needs .*not ${os === "freebsd" ? os : arch}`).test(said), said);
}
await db.node.update({ where: { name: "fra-node-02" }, data: { os: "linux", arch: "x64" } });
const fine = await createServerOp(mara, input("On linux x64", "x64.example.com"));
check("and linux/x64 is not", fine.ok, `${fine.title}: ${fine.body}`);

console.log("\n== an approved community game that fails a rule added after it was approved ==");
{
  const community = await import("../src/lib/community-games");
  const { canonicalJson, hashOf } = await import("../src/domain/games/manifest");
  const { isOffered } = await import("../src/domain/games/registry");
  const IMAGE = `docker.io/library/alpine@sha256:${"a".repeat(64)}`;
  const manifest = (id: string, over: Record<string, unknown> = {}) => ({
    manifest: 1,
    id,
    name: id,
    family: `${id} family`,
    art: "KEEP\nGAME",
    blurb: "A game that is only here to be approved and then tightened.",
    portBase: 26700,
    portSpan: 40,
    ports: [{ id: "game", label: "Game", offset: 0, container: 26700, protocol: "tcp", primary: true }],
    defaults: { memoryGb: 1, cpuLimit: 50, diskGb: 5, playersMax: 8 },
    limits: { memoryGb: [1, 4], cpuLimit: [50, 200], diskGb: [1, 20] },
    requirements: { memoryGbMin: 1, cpuPctMin: 50, diskGbMin: 1, os: ["linux"], arch: ["x64", "arm64"] },
    install: { kind: "image" },
    config: [],
    health: { probes: [{ kind: "log", pattern: "^up$" }], bootGraceSeconds: 20, readyPattern: "^up$" },
    console: { stopCommand: "stop", examples: ["hello"] },
    versions: [{ id: "r1", label: "r1", image: IMAGE, note: "the only one", released: "2026-10-03", channel: "stable", recommended: true, args: ["sh", "-c", "echo up; sleep 3600"] }],
    templates: [{ id: "default", name: "Default", blurb: "As it comes.", summary: "Says hello.", config: {} }],
    ...over,
  });
  const approved = (m: ReturnType<typeof manifest>) => db.gameManifest.create({ data: { gameId: m.id, revision: 1, manifest: m, hash: hashOf(canonicalJson(m)), state: "APPROVED", name: m.name } });

  community.forgetCommunityGames();
  // The servers made above are not part of this: the node has the room it had.
  await db.server.deleteMany({ where: { name: { in: ["Born Linked A", "Born Linked B", "On linux x64"] } } });
  await db.node.update({ where: { name: "fra-node-02" }, data: { capabilities: ["docker", "steamcmd", "java", "ssd", "community-games"] } });
  const kept = manifest("community-keeps");
  const lonely = manifest("community-lonely", { portBase: 26800, ports: [{ id: "game", label: "Game", offset: 0, container: 26800, protocol: "tcp", primary: true }] });
  const keptRow = await approved(kept);
  const lonelyRow = await approved(lonely);
  const first = await community.refreshCommunityGames({ force: true });
  check("both load while they pass", first.active.includes("community-keeps") && first.active.includes("community-lonely") && first.stale.length === 0, JSON.stringify(first));
  const stored = await db.gameManifest.findUniqueOrThrow({ where: { id: keptRow.id } });
  check("and what each validated into is kept beside its manifest", stored.definition !== null && (stored.definition as { id?: string }).id === "community-keeps");
  await syncCatalog({ offline: true });
  const made = await createServerOp(mara, {
    name: "Keeps Serving",
    host: "keeps.example.com",
    gameId: "community-keeps",
    versionId: "r1",
    templateId: "default",
    config: {},
    nodeName: "fra-node-02",
    memoryGb: 1,
    cpuLimit: 50,
    diskGb: 5,
  });
  check("a server is made from one of them", made.ok, `${made.title}: ${made.body}`);

  // A rule is added to the validator: simulated by a manifest that no longer passes it (a field that would widen the container), under the
  // hash an owner approved, which is what a later release finds in a database it was upgraded onto.
  for (const row of [keptRow, lonelyRow]) {
    const bad = { ...(row.manifest as Record<string, unknown>), privileged: true };
    await db.gameManifest.update({ where: { id: row.id }, data: { manifest: bad as never, hash: hashOf(canonicalJson(bad)) } });
  }
  const after = await community.refreshCommunityGames({ force: true });
  check("the game that has a server is still found, so the server is still stopped, saved and judged by it", findGame("community-keeps") !== undefined);
  check("it is flagged, with the reason, in the load and for its pages", after.stale.some((s) => s.game === "community-keeps") && /no longer passes the checks/.test(community.communityGameNotice("community-keeps") ?? ""), JSON.stringify(after.stale));
  check("and it is not offered for a new server", !isOffered("community-keeps"));
  check("the one with no server is skipped, as before, and logged", findGame("community-lonely") === undefined && after.skipped.some((s) => s.game === "community-lonely"), JSON.stringify(after.skipped));
  check("a game that still passes carries no flag", community.communityGameNotice("community-lonely") === null);

  await db.server.deleteMany({ where: { gameId: { startsWith: "community-" } } });
  await db.game.deleteMany({ where: { id: { startsWith: "community-" } } });
  await db.gameManifest.deleteMany();
  community.forgetCommunityGames();
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
