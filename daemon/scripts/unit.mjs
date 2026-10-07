// Runs every unit test of the agent: all of test/*.test.ts except the integration file, which drives real containers and
// belongs on a machine with Docker (`npm run verify` runs it too).
//
// The list used to be written out in package.json by name, which meant a new test file was run only if somebody remembered
// to add it — in CI as well as locally. A file here is run because it exists.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import process from "node:process";

const dir = new URL("../test/", import.meta.url);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts") && name !== "integration.test.ts")
  .sort()
  .map((name) => `test/${name}`);

const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", cwd: new URL("..", import.meta.url) });
process.exit(run.status ?? 1);
