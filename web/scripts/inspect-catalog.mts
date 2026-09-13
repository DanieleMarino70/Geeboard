import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* A look at what a sync actually wrote.

   Not a test — the tests cover the arithmetic with stubs. This is for
   the question stubs cannot answer: did real upstream data land in the
   fields it was supposed to? The one that matters is whether a Steam
   build id stayed out of `upstream`, because if it ever gets in there
   every server on that game reads as permanently out of date. */

const { db } = await import("../src/lib/db");

const games = await db.game.findMany({
  orderBy: { name: "asc" },
  include: { versions: { orderBy: [{ recommended: "desc" }, { label: "asc" }] } },
});

for (const game of games) {
  const installable = game.versions.filter((v) => v.supported);
  console.log(
    `\n${game.name} — ${game.versions.length} versions, ${installable.length} installable`,
  );

  for (const v of game.versions.slice(0, 6)) {
    const bits = [
      v.recommended ? "★" : " ",
      v.supported ? " " : "·",
      v.slug.padEnd(24),
      (v.upstream ?? "—").padEnd(12),
      v.channel.toLowerCase().padEnd(9),
      v.origin.toLowerCase().padEnd(18),
      v.branch ? `${v.branch}@${v.buildId}` : "",
    ];
    console.log(`  ${bits.join(" ")}`);
  }
  if (game.versions.length > 6) console.log(`  … ${game.versions.length - 6} more`);
}

/* The check this script exists for. A build id is an integer that sorts
   above every version string a game has ever had; one in `upstream`
   would make every server on that game permanently out of date. */
console.log("\n── build ids never became versions ──");
const leaked = await db.gameVersion.findMany({
  where: { upstream: { not: null }, buildId: { not: null } },
  select: { slug: true, upstream: true, buildId: true },
});
const wrong = leaked.filter((v) => v.upstream === v.buildId);
console.log(
  wrong.length === 0
    ? `  clean — ${leaked.length} versions carry both, none confused them`
    : `  LEAKED: ${wrong.map((v) => v.slug).join(", ")}`,
);

console.log("\n── servers linked to the catalog ──");
const servers = await db.server.findMany({
  select: { name: true, game: true, version: true, gameId: true, gameVersionId: true },
  orderBy: { name: "asc" },
});
for (const s of servers) {
  console.log(
    `  ${s.name.padEnd(20)} ${s.game.padEnd(12)} ${s.version.padEnd(18)} ${
      s.gameVersionId ? "linked" : "no catalog link"
    }`,
  );
}

await db.$disconnect();
