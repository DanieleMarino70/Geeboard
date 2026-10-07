import "./load-env.mts";
import process from "node:process";

/* The first server on a small machine, for every game that ships.

   The documented VPS proof ran on a 3.8 GB machine with two cores, which the agent counts as three whole gigabytes and 200% of CPU, and the
   one game it created was the one whose defaults fit (Terraria). Every other game's first screen asked for what the game would like and the
   node could not take; and with no DNS provider and no server yet, the address offered was the sample workspace's own domain. This is the
   panel's side of the fix, against a workspace that is exactly that machine: what the wizard starts a server at (fitToNode), what the create
   operation then says to it, and what it says when the game's floor does not fit. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { createServerOp, nodeCapacities, workspaceDomain } = await import("../src/lib/create-ops");
const { games, defaultVersion, gameForVersion } = await import("../src/lib/catalog");
const { applyTemplate } = await import("../src/domain/games/config");
const { fitToNode } = await import("../src/lib/create-wizard");
const { dnsProviderFacts } = await import("../src/lib/dns-ops");

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

console.log("\n== a workspace that is one machine of 3 GB and two cores, with no domain of its own ==");
await seed();
const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
// Servers go first, which takes their records with them; then every node but the small one.
await db.server.deleteMany();
await db.node.deleteMany();
await db.node.create({
  data: {
    name: "vps",
    city: "vps",
    region: "eu-central",
    state: "HEALTHY",
    pingMs: 1,
    cpuPct: 5,
    ramPct: 10,
    diskPct: 10,
    cpuCores: 2,
    ramTotal: 3,
    diskTotal: 40,
    daemon: "0.8.1",
    registeredAt: new Date(),
    approvedAt: new Date(),
    os: "linux",
    arch: "x64",
    capabilities: ["docker", "steamcmd", "java", "ssd"],
  },
});

check("there is no DNS provider", (await dnsProviderFacts()) === null);
check("and no domain: the wizard is not offered a name nobody owns", (await workspaceDomain()) === null, String(await workspaceDomain()));

console.log("\n== every shipped game, started at what the wizard starts it at ==");
let created = 0;
let refused = 0;
for (const game of games()) {
  const [node] = await nodeCapacities();
  const fit = fitToNode(game, node!);
  const version = defaultVersion(game);
  const template = game.templates[0]!;
  const input = {
    name: `First ${game.name}`,
    host: `${game.id}.example.com`,
    gameId: game.id,
    versionId: version.id,
    templateId: template.id,
    config: applyTemplate(gameForVersion(game, version.id), template.id),
    nodeName: "vps",
    memoryGb: fit.memoryGb,
    cpuLimit: fit.cpuLimit,
    diskGb: fit.diskGb,
  };
  const result = await createServerOp(mara, input);

  if (fit.short.length === 0) {
    check(`${game.id}: ${fit.memoryGb} GB, ${fit.cpuLimit}%, ${fit.diskGb} GB is created${fit.lowered.length ? ` (${fit.lowered.join(", ")})` : ""}`, result.ok, `${result.title}: ${result.body}`);
    if (result.ok) created++;
  } else {
    check(`${game.id}: its floor does not fit, and the refusal names the node's numbers (${fit.short[0]})`, !result.ok && /has \d+ of its 3 GB of memory not yet promised to a server, and this one asks for \d+ GB/.test(result.body), `${result.title}: ${result.body}`);
    if (!result.ok) refused++;
  }
  // The next game is the first server too.
  await db.server.deleteMany();
}
check(`at least one game each way, so that both sentences were tried (${created} created, ${refused} refused)`, created >= 3 && refused >= 1);

console.log("\n== what it was, for the record ==");
{
  const [node] = await nodeCapacities();
  const minecraft = games().find((g) => g.id === "minecraft-java")!;
  const unfitted = await createServerOp(mara, {
    name: "As The Game Likes It",
    host: "old.example.com",
    gameId: minecraft.id,
    versionId: defaultVersion(minecraft).id,
    templateId: minecraft.templates[0]!.id,
    nodeName: node!.name,
    memoryGb: minecraft.defaults.memoryGb,
    cpuLimit: minecraft.defaults.cpuLimit,
    diskGb: minecraft.defaults.diskGb,
  });
  check("Minecraft at its own defaults (8 GB, three cores) is refused on this machine, and says what the machine has", !unfitted.ok && /vps has 3 of its 3 GB of memory not yet promised to a server, and this one asks for 8 GB/.test(unfitted.body), `${unfitted.title}: ${unfitted.body}`);
}

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
