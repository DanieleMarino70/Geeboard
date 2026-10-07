// Runs the verification scripts one after another, keeps going when one fails, and ends with one table.
//
//   tsx scripts/verify-all.mts                     the checks that need only Postgres (`npm run verify`)
//   tsx scripts/verify-all.mts --all               those, then the ones that drive real containers (`npm run verify:all`)
//   tsx scripts/verify-all.mts --only a,b          just these, by their package.json names
//   tsx scripts/verify-all.mts --bail              stop at the first failure, as the old chain did
//
// It imports load-env first, so a database that is not named for verification is refused before the first script
// starts, and the first line of the run says which database is about to be wiped.
import "./load-env.mts";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { DB_GROUP, DOCKER_GROUP } from "./verify-registry.mts";

const args = process.argv.slice(2);
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : null;
const names: readonly string[] = only ?? (args.includes("--all") ? [...DB_GROUP, ...DOCKER_GROUP] : DB_GROUP);
const bail = args.includes("--bail");
/* A script that has not finished in this long is stuck, not slow: the longest, verify:backups, takes about four minutes. */
const TIMEOUT_MS = 15 * 60_000;

interface Outcome {
  name: string;
  seconds: number;
  code: number | null;
  timedOut: boolean;
}

function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function run(name: string): Promise<Outcome> {
  const started = Date.now();
  console.log(`\n══ ${name} ${"═".repeat(Math.max(3, 70 - name.length))}`);
  return new Promise((resolve) => {
    // A shell, because `npm` is a .cmd file on Windows and Node will not start one directly.
    const child = spawn(`npm run --silent ${name}`, { shell: true, stdio: "inherit", env: process.env, detached: process.platform !== "win32" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid!);
    }, TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ name, seconds: Math.round((Date.now() - started) / 100) / 10, code, timedOut });
    });
  });
}

const outcomes: Outcome[] = [];
for (const name of names) {
  const outcome = await run(name);
  outcomes.push(outcome);
  if (bail && (outcome.code !== 0 || outcome.timedOut)) break;
}

const failed = outcomes.filter((o) => o.code !== 0 || o.timedOut);
const skipped = names.slice(outcomes.length);
const width = Math.max(...names.map((n) => n.length));
const lines = [
  "",
  `══ ${outcomes.length - failed.length} of ${names.length} passed ${"═".repeat(48)}`,
  ...outcomes.map((o) => `  ${o.code === 0 && !o.timedOut ? "ok  " : "FAIL"} ${o.name.padEnd(width)}  ${String(o.seconds).padStart(6)} s${o.timedOut ? "  (timed out)" : o.code !== 0 ? `  (exit ${o.code})` : ""}`),
  ...skipped.map((n) => `  --   ${n.padEnd(width)}  not run (--bail)`),
];
console.log(lines.join("\n"));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Verification", "", "| script | seconds | result |", "| --- | ---: | --- |", ...outcomes.map((o) => `| ${o.name} | ${o.seconds} | ${o.code === 0 && !o.timedOut ? "ok" : o.timedOut ? "timed out" : `exit ${o.code}`} |`), ""].join("\n"),
  );
}
/* For pasting into the roadmap's "Verified." paragraph; gitignored. */
writeFileSync("verify-report.json", JSON.stringify({ at: new Date().toISOString(), outcomes, skipped }, null, 2));

process.exit(failed.length > 0 ? 1 : 0);
