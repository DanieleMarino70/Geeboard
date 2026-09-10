import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

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
const { db } = await import("../src/lib/db");

const offline = process.argv.includes("--offline");
const refresh = process.argv.includes("--refresh");

const started = Date.now();
const report = await syncCatalog({ offline, refresh });

console.log(
  `catalog: ${report.games} games, ${report.versions} versions` +
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
