import path from "node:path";
import process from "node:process";

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
