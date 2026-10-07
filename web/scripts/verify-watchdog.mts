import "./load-env.mts";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import pg from "pg";

/* The watchdog against a real Postgres and the real poller process: one poller per database, a row that says when it last passed, the
   healthcheck that reads it, and what happens when a poller is killed. Needs Postgres only — the poller has no node to watch here, and a
   pass over none is a pass. */

const { db } = await import("../src/lib/db");
const { acquirePollerLock, PollerLockHeld } = await import("../src/lib/poller-lock");
const { markPassBegan, markPassFinished, markStarted, readWatchdog } = await import("../src/lib/watchdog");

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.DATABASE_URL!;
const web = path.join(import.meta.dirname, "..");

async function until(label: string, test: () => Promise<boolean>, ms = 30_000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await test().catch(() => false)) return true;
    await sleep(250);
  }
  console.log(`  (gave up waiting for: ${label})`);
  return false;
}

function health(): { code: number | null; out: string } {
  const run = spawnSync(process.execPath, ["scripts/poller-health.mjs"], { cwd: web, env: process.env, encoding: "utf8" });
  return { code: run.status, out: run.stdout.trim() };
}

/* The whole tree, because the poller is started through a shell and npx: on Windows taskkill /T, elsewhere the process group (it is started
   detached, as verify-all starts its scripts). Killing the shell alone leaves the poller running, and the lock held. */
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/* A poller as the compose file runs it: its own process. Output kept, to read what it said. */
function startPoller(extra: Record<string, string> = {}, args: string[] = []) {
  const output: string[] = [];
  const child = spawn("npx", ["tsx", "--conditions=react-server", "scripts/poller.mts", ...args], {
    cwd: web,
    shell: true,
    detached: process.platform !== "win32",
    env: { ...process.env, POLL_INTERVAL_MS: "1000", LOG_FORMAT: "text", LOG_LEVEL: "info", ...extra },
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, output, exited, text: () => output.join("") };
}

await db.pollerState.deleteMany();

console.log("\n== the lock: one poller per database ==");
let lost: string | null = null;
const first = await acquirePollerLock(url, (why) => (lost = why));
let refused: unknown = null;
try {
  await acquirePollerLock(url, () => {});
} catch (error) {
  refused = error;
}
check("a second poller is refused while the first holds the lock", refused instanceof PollerLockHeld, String(refused));
check("and is told why, in a sentence that names what two of them do", /another poller is already running[\s\S]*twice/.test(String((refused as Error | null)?.message)));
await first.release();
const again = await acquirePollerLock(url, () => {}).then((lock) => lock, () => null);
check("the lock is free once its holder lets go", again !== null);
await again?.release();
check("letting go is not reported as losing it", lost === null);

console.log("\n== the lock goes when its connection does ==");
let gone: string | null = null;
const held = await acquirePollerLock(url, (why) => (gone = why));
const admin = new pg.Client({ connectionString: url });
await admin.connect();
const holder = await admin.query(
  "select pid from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid() limit 1",
);
check("the lock is on a connection of its own", holder.rows.length === 1);
await admin.query("select pg_terminate_backend($1)", [holder.rows[0]?.pid]);
check("when the database ends that connection the poller is told, and says it will leave", await until("lost", async () => gone !== null, 5_000) && /ended|failed/.test(gone ?? ""), String(gone));
await held.release();
await admin.end();

console.log("\n== the row, and what is said of it ==");
check("nothing is said before any poller has reported", (await readWatchdog())?.state === "waiting");
await markStarted(1_000);
check("a poller that has started and not passed yet is waiting", (await readWatchdog())?.state === "waiting");
await markPassBegan();
await markPassFinished({ servers: 3, nodes: 2, errors: 1, ms: 840 });
const fresh = await readWatchdog();
check("a pass that finished reads as ok, a few seconds old at most", fresh?.state === "ok" && /last pass \d+ s ago/.test(fresh.line), fresh?.line);
const row = await db.pollerState.findUnique({ where: { id: 1 } });
check("its figures are stored: servers, nodes, errors, how long, and which release", row?.servers === 3 && row?.nodes === 2 && row?.errors === 1 && row?.lastPassMs === 840 && !!row?.version);

console.log("\n== the container's healthcheck reads the same row ==");
check("healthy with a pass a moment ago", health().code === 0, health().out);
// Ten seconds on, with the pass before it having begun a second earlier: a poller that finished a pass and has done nothing since.
await db.pollerState.update({ where: { id: 1 }, data: { lastPassAt: new Date(Date.now() - 10_000), passStartedAt: new Date(Date.now() - 11_000) } });
const unhealthy = health();
check("unhealthy past three intervals, with the reason", unhealthy.code === 1 && /more than 3 intervals/.test(unhealthy.out), `${unhealthy.code} ${unhealthy.out}`);
check("and the page says late", (await readWatchdog())?.state === "late");
await db.pollerState.update({ where: { id: 1 }, data: { passStartedAt: new Date(Date.now() - 8_000) } });
check("a pass that has run past three intervals is unhealthy as well, and the page says what it is", health().code === 1 && /pass has been running/.test((await readWatchdog())?.line ?? ""));
await db.pollerState.deleteMany();
check("no row at all is unhealthy", health().code === 1);

console.log("\n== the real poller, twice ==");
const one = startPoller();
const reported = await until("the first poller's first pass", async () => !!(await db.pollerState.findUnique({ where: { id: 1 } }))?.lastPassAt, 60_000);
check("the first poller starts and finishes a pass", reported, one.text().slice(-400));
const when = (await db.pollerState.findUnique({ where: { id: 1 } }))?.lastPassAt?.getTime() ?? 0;
await sleep(2_500);
const later = (await db.pollerState.findUnique({ where: { id: 1 } }))?.lastPassAt?.getTime() ?? 0;
check("and keeps passing: the row moves", later > when);
check("healthy while it runs", health().code === 0, health().out);

const two = startPoller();
const code = await Promise.race([two.exited, sleep(60_000).then(() => "timeout" as const)]);
check("a second poller leaves, with exit code 75", code === 75, `exit ${code}\n${two.text().slice(-400)}`);
check("in one line that says why", /another poller is already running against this database/.test(two.text()) && two.text().trim().split("\n").length <= 3, two.text().slice(-300));
const stillOne = (await db.pollerState.findUnique({ where: { id: 1 } }))?.lastPassAt?.getTime() ?? 0;
check("and the first one did not notice: its row went on moving", stillOne >= later);

const once = startPoller({}, ["--once"]);
const onceCode = await Promise.race([once.exited, sleep(60_000).then(() => "timeout" as const)]);
check("a poll:once beside a running poller refuses as well, instead of overlapping a pass", onceCode === 75, `exit ${onceCode}\n${once.text().slice(-300)}`);

console.log("\n== killing the poller ==");
killTree(one.child);
await one.exited;
const killedAt = Date.now();
const wentLate = await until("the page to say late", async () => (await readWatchdog())?.state === "late", 20_000);
check("the page says late within three intervals of it being killed (three seconds here)", wentLate && Date.now() - killedAt < 8_000, `${Date.now() - killedAt} ms`);
const sick = health();
check("and the healthcheck says unhealthy", sick.code === 1, `${sick.code} ${sick.out}`);

console.log("\n== a poller that took its place takes the lock ==");
const three = startPoller();
const backUp = await until("the replacement's pass", async () => (await readWatchdog())?.state === "ok", 60_000);
check("a new poller takes the lock the dead one left, and the page is ok again", backUp, three.text().slice(-300));
killTree(three.child);
await three.exited;

await db.pollerState.deleteMany();
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
