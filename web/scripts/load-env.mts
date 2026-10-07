import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { databaseOf, refuseVerify } from "./db-guard.mts";

/* Reads web/.env if there is one, and shrugs if there is not.

   A checkout has the file. A container, a systemd unit and a CI runner
   have the variables in the environment and no file at all — and
   `process.loadEnvFile` throws ENOENT rather than ignoring a missing
   one, which stopped every verify script on the first line it ran in CI.

   Imported for its side effect, as the first import of a script, so the
   variables are in place before anything that reads them is loaded:

     import "./load-env.mts";

   A variable already set wins over the file, which is what lets a
   command name a database of its own for a verify run. */
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // Already in the environment, or there is nothing to read.
}

/* A verify script reseeds the database it is given, and the one in .env is
   the developer's own. Every one of them imports this first, so this is
   where the wrong database is refused — see db-guard.mts for why — and where
   the first line of every run says which one it is about to wipe. */
const script = path.basename(process.argv[1] ?? "");
if (script.startsWith("verify-")) {
  const refusal = refuseVerify(script, process.env.DATABASE_URL, process.env.GEEBOARD_VERIFY_ANY_DB === "1");
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }
  const target = databaseOf(process.env.DATABASE_URL);
  if (target) console.log(`database: ${target.name} on ${target.where}`);
}

/* And the panel's own version, which these scripts do not get for free.

   The panel is built by Next, which inlines it from package.json
   (next.config.ts). A script is run by tsx, which does not, so without
   this every check that compares a panel version against an agent's
   would read "unknown" and refuse nobody — including the checks written
   to prove that it refuses somebody. Same file, same number. */
if (!process.env.GEEBOARD_VERSION) {
  try {
    const { version } = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string };
    if (version) process.env.GEEBOARD_VERSION = version;
  } catch {
    // Run from somewhere without a package.json: unknown, and honest about it.
  }
}
