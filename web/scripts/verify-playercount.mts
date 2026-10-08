import "./load-env.mts";
import process from "node:process";

/* A player count is a number somebody read. A game whose console says who joins and leaves has one; a game that does not (a manifest that gave no
   patterns, a definition kept but not offered) has a 0 that nobody read, and summed into the dashboard's tile or printed in a list it reads as
   "nobody is on", which is a claim. Against a real Postgres: the tile counts the servers it was read on, over their slots, and says how many it
   left out. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
const { getDashboardStats } = await import("../src/lib/queries");
const { allGames } = await import("../src/domain/games/registry");

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

const reads = allGames().filter((g) => g.console.players).map((g) => g.id);
check("the shipped games that are offered all say who joins (so the tile has something to count)", reads.length >= 4, reads.join());

const servers = await db.server.findMany({ orderBy: { name: "asc" } });
// Every server, on a node the panel can see, with a count and slots of its own; one of them with a game that reads nothing.
for (const [i, s] of servers.entries()) {
  await db.server.update({ where: { id: s.id }, data: { playersOn: 3 + i, playersMax: 10 * (i + 1) } });
}
const before = await getDashboardStats();
check("with every game reading, nothing is left out", before.playersUncounted === servers.filter((s) => !s.gameId || !reads.includes(s.gameId)).length, JSON.stringify(before));

const silent = servers[0]!;
await db.server.update({ where: { id: silent.id }, data: { gameId: null, playersOn: 7, playersMax: 50 } });
const after = await getDashboardStats();
const readable = await db.server.findMany({ where: { gameId: { in: reads } } });
const sumOn = readable.reduce((n, s) => n + s.playersOn, 0);
const sumMax = readable.reduce((n, s) => n + s.playersMax, 0);
check("a server whose game reads nothing is not in the players figure", after.playersOnline === sumOn, `${after.playersOnline} vs ${sumOn}`);
check("nor in the slots it is shown over", after.playersMax === sumMax, `${after.playersMax} vs ${sumMax}`);
check("and the tile can say that one was left out", after.playersUncounted >= before.playersUncounted + 1, `${before.playersUncounted} -> ${after.playersUncounted}`);

await seed();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
