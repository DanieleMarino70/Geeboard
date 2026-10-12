import "./load-env.mts";
import process from "node:process";

/* Writes the game definitions, and what upstream says about them, into
   the catalog tables.

   This is the one place in Geeboard that goes out to the network for
   version information. Nothing rendering a page does, which is why a
   Steam outage cannot take the games list down — it can only make it
   stale, and `syncedAt` says by how much.

   Safe to run repeatedly, and safe to run against a database with live
   servers on it: everything is an upsert, a game that has left the
   registry is retired rather than deleted, and servers that predate the
   catalog are linked up where their labels still resolve.

     npm run games:sync              ask upstream, using the cache
     npm run games:sync -- --refresh ask upstream, ignoring the cache
     npm run games:sync -- --offline definitions only, no network
*/

const { syncCatalog } = await import("../src/lib/catalog-sync");
const { refreshCommunityGames } = await import("../src/lib/community-games");
const { db } = await import("../src/lib/db");

const offline = process.argv.includes("--offline");
const refresh = process.argv.includes("--refresh");

const started = Date.now();
/* The games an owner approved from a manifest are rows, and a game in this
   process only once they are read: read here as the poller reads them, so
   the catalog written below holds them. This is what the image's `migrate`
   runs after every upgrade, and without it each approved game was retired
   until the poller's next full sync. A load that fails is said and the sync
   goes on: the games Geeboard ships do not depend on it, and a sync that
   has not loaded them leaves their rows as they are. */
try {
  await refreshCommunityGames({ force: true });
} catch (error) {
  console.warn(`  ! community games were not loaded, and their rows are left as they are: ${error instanceof Error ? error.message : String(error)}`);
}
const report = await syncCatalog({ offline, refresh });

console.log(
  `catalog: ${report.games} games, ${report.versions} versions` +
    (report.renamed > 0 ? `, ${report.renamed} renamed` : "") +
    (report.linked > 0 ? `, ${report.linked} existing servers linked` : "") +
    ` (${offline ? "offline" : "upstream"}, ${Date.now() - started}ms)`,
);
for (const id of report.retired) {
  console.warn(`  retired: ${id} (no definition; its servers keep running)`);
}
for (const error of report.providerErrors) {
  console.warn(`  ! ${error.game} via ${error.provider}: ${error.message}`);
}

/* A provider being down is not a reason for the sync to fail — the rows
   it could not refresh keep whatever they had. It is a reason to say so
   in the exit code, so a scheduled sync can be noticed. */
process.exitCode = report.providerErrors.length > 0 ? 1 : 0;
await db.$disconnect();
