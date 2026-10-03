import "./load-env.mts";

/* A second process, reading what verify:community changed: the poller is its own
   process and the registry is in memory, so a game approved here has to arrive
   there by the database. Prints one line of JSON and nothing else. */

const { refreshCommunityGames } = await import("../src/lib/community-games");
const { findGame, allGames, communityGameIds } = await import("../src/domain/games/registry");
const { isGuarded } = await import("../src/domain/games/matcher");
const { db } = await import("../src/lib/db");

const wanted = process.argv[2] ?? "";
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
