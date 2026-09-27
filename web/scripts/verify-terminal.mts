import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { SignJWT } from "jose";
import { startPanel, stopPanel, waitForPanel, type Panel } from "./verify-panel.mts";

/* End to end: the node terminal. Two real agents — one whose machine
   allows a shell, one that does not — heartbeating into a real panel,
   and a client doing what the browser does: the open with a fresh code,
   the stream, typing in numbered requests, a resize, a dropped stream
   picking the session back up, the close, and the audit lines left
   behind with nothing typed in them. Then every refusal a person can
   meet, and the two ways a running session is closed from under them.

   Needs Postgres and nothing else: the shell is Node's own REPL, which
   answers on every machine this runs on. Reseeds the database it is
   pointed at. */

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { STREAM_RECHECK_MS } = await import("../src/domain/access/streams");
const { base32Decode, stepOf, totp } = await import("../src/domain/access/totp");
const account = await import("../src/lib/account-ops");
const { seed } = await import("../prisma/seed");

const TOKEN_ON = "terminal-on-agent-token-long-enough-ok!";
const TOKEN_OFF = "terminal-off-agent-token-long-enough-ok";
const AGENT_ON = 8700 + Math.floor(Math.random() * 40);
const AGENT_OFF = AGENT_ON + 40;
const PANEL_PORT = 3400 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PANEL_PORT}`;

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

let agentOn: ChildProcess | undefined;
let agentOff: ChildProcess | undefined;
let panelProc: Panel | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => Promise<boolean>, label: string, tries = 80, everyMs = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true;
    } catch {
      /* not ready */
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* The agent's environment is built, not inherited: a GEEBOARD_TERMINAL in
   the developer's shell would switch the "off" agent on in silence. */
type Env = Record<string, string | undefined>;
function cleanEnvironment(): Env {
  const env: Env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GEEBOARD_/i.test(key)) env[key] = value;
  return env;
}

function startAgent(port: number, token: string, name: string, extra: Env): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...cleanEnvironment(),
      GEEBOARD_DAEMON_TOKEN: token,
      GEEBOARD_DAEMON_PORT: String(port),
      GEEBOARD_DAEMON_HOST: "127.0.0.1",
      GEEBOARD_NODE_NAME: name,
      GEEBOARD_PANEL_URL: base,
      GEEBOARD_ADVERTISE_URL: `http://127.0.0.1:${port}`,
      LOG_LEVEL: "error",
      ...extra,
    } as unknown as NodeJS.ProcessEnv,
    stdio: "ignore",
  });
}

const agentApi = (port: number, token: string, route: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

/** Reads a Server-Sent Events body as it arrives. */
function follow(res: Response) {
  const body = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let ended = false;
  const until = (want: RegExp | string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const has = () => (typeof want === "string" ? text.includes(want) : want.test(text));
      const timer = setTimeout(() => resolve(has()), ms);
      void (async () => {
        while (!ended && !has()) {
          const chunk = await body.read().catch(() => ({ done: true, value: undefined }));
          if (chunk.done) ended = true;
          else text += decoder.decode(chunk.value, { stream: true });
        }
        clearTimeout(timer);
        resolve(has());
      })();
    });
  /** Everything the shell printed, out of the `out` events, with terminal sequences stripped. */
  const printed = () =>
    [...text.matchAll(/^event: out\ndata: (.*)$/gm)]
      .map((m) => (JSON.parse(m[1]!) as { d: string }).d)
      .join("")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const event = (name: string) => {
    const m = new RegExp(`^event: ${name}\\ndata: (.*)$`, "m").exec(text);
    return m ? (JSON.parse(m[1]!) as Record<string, unknown>) : null;
  };
  return { until, text: () => text, printed, event, closed: () => ended, cancel: () => body.cancel().catch(() => {}) };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const WIDTH = "process.stdout.getWindowSize()[0]\r";

try {
  await seed();

  console.log("\n== stand up two agents and the panel ==");
  panelProc = startPanel(PANEL_PORT, { ...process.env, GEEBOARD_DIST_DIR: ".next-terminal" });
  await waitForPanel(panelProc, base);
  check("panel is up", true);

  const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
  const devi = (await db.user.findUnique({ where: { email: "devi@ashfold.gg" } }))!;

  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${AGENT_ON}`, daemonToken: encryptSecret(TOKEN_ON) },
  });
  await db.node.update({
    where: { name: "ash-node-01" },
    data: { daemonUrl: `http://127.0.0.1:${AGENT_OFF}`, daemonToken: encryptSecret(TOKEN_OFF) },
  });
  // An agent with a URL and a token that never says anything about a terminal: one from before 0.3.5.
  await db.node.update({
    where: { name: "sgp-node-01" },
    data: { daemonUrl: "http://127.0.0.1:1", daemonToken: encryptSecret("old-agent-token-long-enough-for-this"), daemon: "0.3.2" },
  });

  agentOn = startAgent(AGENT_ON, TOKEN_ON, "fra-node-02", { GEEBOARD_TERMINAL: "1", GEEBOARD_TERMINAL_SHELL: process.execPath });
  agentOff = startAgent(AGENT_OFF, TOKEN_OFF, "ash-node-01", {});
  await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_ON}/health`).catch(() => null)) !== null, "agent on");
  await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_OFF}/health`).catch(() => null)) !== null, "agent off");
  check("both agents are up", true);

  /* The panel learns about a terminal from heartbeats and nowhere else. */
  await waitFor(
    async () => {
      const [on, off] = await Promise.all([
        db.node.findUnique({ where: { name: "fra-node-02" }, select: { terminal: true } }),
        db.node.findUnique({ where: { name: "ash-node-01" }, select: { terminal: true } }),
      ]);
      return (on?.terminal as { state?: string } | null)?.state === "on" && (off?.terminal as { state?: string } | null)?.state === "off";
    },
    "heartbeats carrying the terminal",
    120,
  );
  const said = (await db.node.findUnique({ where: { name: "fra-node-02" }, select: { terminal: true } }))!.terminal as Record<string, string>;
  check("a heartbeat told the panel the terminal is on, as whom and with what", said.state === "on" && said.shell === process.execPath && said.user.length > 0, JSON.stringify(said));
  check("the machine that did not switch it on says off", ((await db.node.findUnique({ where: { name: "ash-node-01" } }))!.terminal as { state: string }).state === "off");

  /* Sign-ins as the browser makes them: a session row and its cookie. */
  const sessionFor = async (userId: string) => {
    const session = await db.session.create({ data: { userId, expiresAt: new Date(Date.now() + 9e5), userAgent: "verify" } });
    const jwt = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("900s")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    return { id: session.id, cookie: `gb_session=${jwt}` };
  };

  /* The owner enrols two-factor for real, through the account operations,
     with a secret this script holds — only in this database, which the
     seed at the end puts back. */
  console.log("\n== the owner enrols two-factor ==");
  const begun = await account.beginTwoFactorOp(mara);
  if (!begun.ok || !("secret" in begun)) throw new Error("two-factor enrolment did not begin");
  const secret = base32Decode(begun.secret);
  const confirmed = await account.confirmTwoFactorOp((await db.user.findUnique({ where: { id: mara.id } }))!, totp(secret, Date.now()));
  check("mara has two-factor", confirmed.ok);
  let usedStep = stepOf(Date.now());
  /* A fresh code every time: the one that signed in is spent, and so is
     any step at or before it. The step after the last one used is inside
     the verifier's window as soon as the clock has reached the one before it. */
  const freshCode = async () => {
    await waitFor(async () => stepOf(Date.now()) >= usedStep, "the next code", 80, 500);
    usedStep = stepOf(Date.now()) + 1;
    return totp(secret, usedStep * 30_000);
  };

  const owner = await sessionFor(mara.id);
  await db.user.update({ where: { id: devi.id }, data: { twoFactor: true } });
  const admin = await sessionFor(devi.id);
  const origin = { origin: base, "content-type": "application/json" };
  const openAs = (cookie: string, node: string, body: Record<string, unknown>, headers: Record<string, string> = origin) =>
    fetch(`${base}/api/nodes/${node}/terminal`, { method: "POST", headers: { cookie, ...headers }, body: JSON.stringify(body) });
  const json = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;

  console.log("\n== who may open one ==");
  const asAdmin = await openAs(admin.cookie, "fra-node-02", { code: "000000", cols: 100, rows: 30 });
  check("an admin is refused: the terminal is the owner's alone", asAdmin.status === 403, String(asAdmin.status));
  const noOrigin = await openAs(owner.cookie, "fra-node-02", { code: "000000" }, { "content-type": "application/json" });
  check("a request with no Origin is not one of the panel's pages", noOrigin.status === 403, String(noOrigin.status));
  const wrong = await openAs(owner.cookie, "fra-node-02", { code: "000000", cols: 100, rows: 30 });
  const wrongBody = await json(wrong);
  check("a wrong code is refused", wrong.status === 401 && wrongBody.code === "code", `${wrong.status} ${JSON.stringify(wrongBody)}`);
  check(
    "and refused is in the audit log, with the node and no code",
    (await db.activityEvent.count({ where: { action: "node.terminal.refused", target: "fra-node-02", userId: mara.id } })) === 1,
  );
  const off = await json(await openAs(owner.cookie, "ash-node-01", { code: "000000", cols: 100, rows: 30 }));
  check("a node whose machine did not allow it says so, before any code is looked at", off.code === "terminal-off" && /GEEBOARD_TERMINAL=1/.test(String(off.body)), JSON.stringify(off));
  const old = await json(await openAs(owner.cookie, "sgp-node-01", { code: "000000" }));
  check("an agent from before the terminal is too old", old.code === "agent-old" && /0\.3\.2/.test(String(old.body)), JSON.stringify(old));
  await db.node.update({ where: { name: "ash-node-01" }, data: { approvedAt: null } });
  const pending = await json(await openAs(owner.cookie, "ash-node-01", { code: "000000" }));
  check("a node waiting for approval takes no terminal", pending.code === "node-pending", JSON.stringify(pending));
  await db.node.update({ where: { name: "ash-node-01" }, data: { approvedAt: new Date() } });
  const gone = await json(await openAs(owner.cookie, "no-such-node", { code: "000000" }));
  check("a node that is not there", gone.code === "node-gone", JSON.stringify(gone));

  console.log("\n== a session, end to end ==");
  const opened = await openAs(owner.cookie, "fra-node-02", { code: await freshCode(), cols: 100, rows: 30 });
  const session = await json(opened);
  check("the owner opens a terminal with a fresh code", opened.status === 201 && typeof session.id === "string", `${opened.status} ${JSON.stringify(session)}`);
  const id = session.id as string;
  const shellFacts = session.shell as { user: string; program: string; scope: string };
  check("the answer names the shell and the account", shellFacts.program === process.execPath && shellFacts.user.length > 0, JSON.stringify(shellFacts));
  check(
    "opened is in the audit log, with the node and the shell and nothing else",
    (await db.activityEvent.findFirst({ where: { action: "node.terminal.opened", target: "fra-node-02" } })) !== null,
  );

  const streamAs = (cookie: string) => fetch(`${base}/api/terminal/${id}/stream`, { headers: { cookie } });
  const other = await sessionFor(mara.id);
  check("the same account from another sign-in is refused the stream", (await streamAs(other.cookie)).status === 403);
  check("an admin is refused the stream", (await streamAs(admin.cookie)).status === 403);

  const stream = follow(await streamAs(owner.cookie));
  check("the stream opens and names the session", await stream.until(/^event: open$/m, 15_000), stream.text().slice(-200));
  await stream.until(/"pid":\d+/, 15_000);
  const pid = Number(/"pid":(\d+)/.exec(stream.text())?.[1]);
  check("the shell is running on the node", Number.isInteger(pid) && alive(pid), String(pid));

  const type = (seq: number, d: string, cookie = owner.cookie) =>
    fetch(`${base}/api/terminal/${id}/input`, { method: "POST", headers: { cookie, ...origin }, body: JSON.stringify({ seq, d }) });
  check("typing needs the panel's own Origin", (await fetch(`${base}/api/terminal/${id}/input`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ seq: 0, d: "x" }) })).status === 403);
  check("another sign-in cannot type into it", (await type(0, "x", other.cookie)).status === 404);

  const first = await json(await type(0, WIDTH));
  check("what is typed reaches the shell", first.accepted === true, JSON.stringify(first));
  check("and the shell's answer comes back: 100 columns wide", await stream.until(/\b100\b/, 10_000), stream.printed().slice(-120));
  const again = await json(await type(0, WIDTH));
  check("the same number sent again is not typed twice", again.accepted === false && again.reason === "already typed", JSON.stringify(again));
  const older = await json(await type(-5, WIDTH));
  check("nor is an older one", older.accepted === false, JSON.stringify(older));

  const resized = await json(await fetch(`${base}/api/terminal/${id}/resize`, { method: "POST", headers: { cookie: owner.cookie, ...origin }, body: JSON.stringify({ cols: 132, rows: 43 }) }));
  check("a resize is taken", resized.ok === true);
  await sleep(300);
  const before = stream.printed().length;
  await type(1, WIDTH);
  // On what the shell printed after the resize, not on the raw stream: an id or a pid may contain the same digits.
  const widened = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      if (/\b132\b/.test(stream.printed().slice(before))) return true;
      await stream.until(/never matches/, 250);
    }
    return false;
  })();
  check("and the shell sees the new width", widened, stream.printed().slice(before).slice(-120));

  const second = await streamAs(owner.cookie);
  check("a second stream on an attached session is turned away", second.status === 409, String(second.status));

  /* A dropped stream: the shell waits, and the next stream gets what it missed. */
  await stream.cancel();
  await sleep(500);
  await type(2, "'kept-' + 'while-away'\r");
  await sleep(700);
  const back = follow(await streamAs(owner.cookie));
  check("a stream that dropped picks the session back up", await back.until(/^event: open$/m, 10_000));
  check("and is given what the shell printed meanwhile", await back.until(/kept-while-away/, 10_000), back.printed().slice(-160));

  const big = await json(await type(3, "x".repeat(70 * 1024)));
  check("more than a frame at once is refused, not typed", big.accepted === false && /too much/.test(String(big.reason)), JSON.stringify(big));

  const closed = await json(await fetch(`${base}/api/terminal/${id}/close`, { method: "POST", headers: { cookie: owner.cookie, ...origin } }));
  check("closing from the panel ends it", closed.ok === true);
  check("the stream is told, and ends", await back.until(/^event: ended$/m, 10_000) && /closed from the panel/.test(String(back.event("ended")?.reason)), back.text().slice(-200));
  await waitFor(async () => !alive(pid), "the shell to be gone", 40);
  check("the shell is gone from the node", !alive(pid));
  const left = (await (await agentApi(AGENT_ON, TOKEN_ON, "/terminal")).json()) as { sessions: unknown[] };
  check("the agent holds no session", left.sessions.length === 0, JSON.stringify(left.sessions));
  const closedEvent = await db.activityEvent.findFirst({ where: { action: "node.terminal.closed", target: "fra-node-02" }, orderBy: { createdAt: "desc" } });
  const changes = JSON.stringify(closedEvent?.changes ?? {});
  check("closed is in the audit log with the reason, the duration and the bytes", /closed from the panel/.test(changes) && /Duration/.test(changes) && /Typed/.test(changes), changes);
  check("and nothing that was typed or printed", !/getWindowSize|kept-while-away/.test(changes));
  check("the input after the close is refused", (await type(4, "x")).status === 404);

  console.log("\n== a running session is closed from under its owner ==");
  const within = STREAM_RECHECK_MS + 10_000;
  const signedIn = await sessionFor(mara.id);
  const two = await json(await openAs(signedIn.cookie, "fra-node-02", { code: await freshCode(), cols: 80, rows: 24 }));
  const twoStream = follow(await fetch(`${base}/api/terminal/${two.id as string}/stream`, { headers: { cookie: signedIn.cookie } }));
  check("a second session opens", await twoStream.until(/"pid":\d+/, 15_000));
  const twoPid = Number(/"pid":(\d+)/.exec(twoStream.text())?.[1]);
  await db.session.delete({ where: { id: signedIn.id } });
  check(
    "the sign-in ending closes it, saying why",
    (await twoStream.until(/^event: ended$/m, within)) && /signed out/.test(String(twoStream.event("ended")?.reason)),
    twoStream.text().slice(-200),
  );
  await waitFor(async () => !alive(twoPid), "that shell to be gone", 40);
  check("and that shell is gone too", !alive(twoPid));

  const three = await json(await openAs(owner.cookie, "fra-node-02", { code: await freshCode(), cols: 80, rows: 24 }));
  const threeStream = follow(await fetch(`${base}/api/terminal/${three.id as string}/stream`, { headers: { cookie: owner.cookie } }));
  check("a third session opens", await threeStream.until(/"pid":\d+/, 15_000));
  const kept = (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.daemonToken;
  await db.node.update({ where: { name: "fra-node-02" }, data: { daemonToken: encryptSecret("rotated-token-long-enough-for-this-check") } });
  check(
    "the node's token rotated closes it",
    (await threeStream.until(/^event: ended$/m, within)) && /rotated/.test(String(threeStream.event("ended")?.reason)),
    threeStream.text().slice(-200),
  );
  await db.node.update({ where: { name: "fra-node-02" }, data: { daemonToken: kept } });
  for (const s of [stream, back, twoStream, threeStream]) await s.cancel();
} catch (error) {
  fail++;
  console.log(`  FAIL the check itself crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  agentOn?.kill();
  agentOff?.kill();
  stopPanel(panelProc);
  await db.session.deleteMany({ where: { userAgent: "verify" } }).catch(() => {});
  await seed().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
