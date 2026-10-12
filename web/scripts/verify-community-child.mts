import "./load-env.mts";

/* A second process, reading what verify:community changed: the poller is its own
   process and the registry is in memory, so a game approved here has to arrive
   there by the database. Prints one line of JSON and nothing else.

   With --sync it syncs the catalog and says what became of the game's row: after
   reading the manifests as the poller does with --load, and without, as a script
   that never loads the community games. */

const { refreshCommunityGames } = await import("../src/lib/community-games");
const { findGame, allGames, communityGameIds } = await import("../src/domain/games/registry");
const { isGuarded } = await import("../src/domain/games/matcher");
const { db } = await import("../src/lib/db");

const wanted = process.argv[2] ?? "";
if (process.argv.includes("--sync")) {
  const { syncCatalog } = await import("../src/lib/catalog-sync");
  if (process.argv.includes("--load")) await refreshCommunityGames();
  const report = await syncCatalog({ offline: true });
  const row = await db.game.findUnique({ where: { id: wanted }, select: { retiredAt: true } });
  console.log(JSON.stringify({ loaded: communityGameIds(), retired: report.retired, retiredAt: row?.retiredAt?.toISOString() ?? null }));
  await db.$disconnect();
  process.exit(0);
}
const before = { found: findGame(wanted) !== undefined, listed: allGames().some((g) => g.id === wanted) };
const report = await refreshCommunityGames();
const game = findGame(wanted);
console.log(
  JSON.stringify({
    before,
    changed: report.changed,
    found: game !== undefined,
    listed: allGames().some((g) => g.id === wanted),
    official: game?.official ?? null,
    guarded: game ? isGuarded(game.health.readyPattern ?? "") : null,
    ids: communityGameIds(),
  }),
);
await db.$disconnect();
