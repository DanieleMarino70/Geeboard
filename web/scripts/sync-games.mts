import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* Writes the game definitions into the catalog tables.

   Safe to run repeatedly, and safe to run against a database with live
   servers on it: everything is an upsert, a game that has left the
   registry is retired rather than deleted, and servers that predate the
   catalog are linked up where their labels still resolve. */

const { syncCatalog } = await import("../src/lib/catalog-sync");
const { db } = await import("../src/lib/db");

const report = await syncCatalog();

console.log(
  `catalog: ${report.games} games, ${report.versions} versions` +
    (report.linked > 0 ? `, ${report.linked} existing servers linked` : ""),
);
for (const id of report.retired) console.warn(`  retired: ${id} (no definition; its servers keep running)`);
for (const error of report.providerErrors) {
  console.warn(`  ! ${error.game} via ${error.provider}: ${error.message}`);
}

await db.$disconnect();
