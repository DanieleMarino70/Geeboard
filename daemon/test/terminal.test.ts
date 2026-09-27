import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import WebSocket from "ws";
import {
  MAX_FRAME_BYTES,
  TerminalRefusal,
  TerminalSessions,
  descendantsOf,
  describeTerminal,
  loadPty,
  shellEnvironment,
  sizeOf,
  type PtyLibrary,
  type TerminalFrameOut,
  type TerminalPolicy,
  type TerminalSink,
} from "../src/terminal.ts";

/* The node terminal: a shell of this machine, opened from the panel.

   The session manager is checked with a shell that is a plain object,
   so every rule — off by default, one stream per session, the limits,
   the reasons a session ends with, nothing kept after a close — holds
   without a process. Then the same manager runs a real shell through
   the real PTY library, on whatever this machine is, and the agent's
   routes are driven over HTTP and a WebSocket, because a terminal that
   works in a unit test and leaves a process behind in the real one has
   not been tested. */

/* ── A shell made of an object ────────────────────────────────────── */

function fakePty() {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const state = { written: [] as string[], resized: [] as Array<[number, number]>, killed: 0 };
  const pty = {
    pid: 4242,
    cols: 80,
    rows: 24,
    process: "fake",
    handleFlowControl: false,
    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener);
      return { dispose() {} };
    },
    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
      exitListeners.push(listener);
      return { dispose() {} };
    },
    resize: (cols: number, rows: number) => state.resized.push([cols, rows]),
    write: (data: string) => state.written.push(data),
    kill: () => {
      state.killed += 1;
    },
    pause() {},
    resume() {},
    clear() {},
    on() {},
  } as unknown as IPty;
  return {
    pty,
    state,
    emit: (data: string) => dataListeners.forEach((l) => l(data)),
    exit: (exitCode: number) => exitListeners.forEach((l) => l({ exitCode })),
  };
}

function library(): { library: PtyLibrary; spawned: ReturnType<typeof fakePty>[] } {
  const spawned: ReturnType<typeof fakePty>[] = [];
  return {
    spawned,
    library: {
      spawn: () => {
        const made = fakePty();
        spawned.push(made);
        return made.pty;
      },
    },
  };
}

function sink(): TerminalSink & { frames: TerminalFrameOut[]; closed: boolean } {
  const frames: TerminalFrameOut[] = [];
  return {
    frames,
    closed: false,
    send(frame) {
      frames.push(frame);
    },
    close() {
      this.closed = true;
    },
  };
}

const ON: TerminalPolicy = { enabled: true, shell: null, maxSessions: 2, idleMs: 60_000, maxMs: 600_000 };

function manager(policy: Partial<TerminalPolicy> = {}, options: { reservationMs?: number } = {}) {
  const lib = library();
  const kills: number[] = [];
  const sessions = new TerminalSessions({ ...ON, ...policy }, lib, { killTree: (pid) => kills.push(pid), ...options });
  return { sessions, lib, kills };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Rules ────────────────────────────────────────────────────────── */

test("the terminal is off unless the machine said otherwise, and says so", () => {
  const { sessions } = manager({ enabled: false });
  assert.equal(sessions.describe().state, "off");
  assert.throws(
    () => sessions.open({ cols: 80, rows: 24 }),
    (error: unknown) => error instanceof TerminalRefusal && error.code === "terminal-off" && /GEEBOARD_TERMINAL=1/.test(error.message),
  );
});

test("a machine without the PTY library is unavailable, with the reason", () => {
  const sessions = new TerminalSessions(ON, { reason: "the PTY library is not installed: no binary" });
  const described = sessions.describe();
  assert.equal(described.state, "unavailable");
  assert.match(described.reason ?? "", /not installed/);
  assert.throws(
    () => sessions.open({ cols: 80, rows: 24 }),
    (error: unknown) => error instanceof TerminalRefusal && error.code === "terminal-unavailable",
  );
});

test("off wins over unavailable: an operator who did not ask is not told about binaries", () => {
  const described = describeTerminal({ enabled: false, shell: null }, { reason: "no binary" });
  assert.equal(described.state, "off");
  assert.equal(described.reason, undefined);
});

test("a configured shell that is not on the machine makes the terminal unavailable", () => {
  const missing = path.join(tmpdir(), "no-such-shell-geeboard");
  const described = describeTerminal({ enabled: true, shell: missing }, {});
  assert.equal(described.state, "unavailable");
  assert.match(described.reason ?? "", /GEEBOARD_TERMINAL_SHELL/);
  // One that exists is on, and is what the descriptor names.
  const present = describeTerminal({ enabled: true, shell: process.execPath }, {});
  assert.equal(present.state, "on");
  assert.equal(present.shell, process.execPath);
  assert.ok(present.user.length > 0, "the account is named");
  assert.ok(["machine", "container"].includes(present.scope));
});

test("a session is reserved, attached, driven, and gone when closed", () => {
  const { sessions, lib, kills } = manager();
  const reserved = sessions.open({ cols: 100, rows: 30 }, "req-0123456789");
  assert.match(reserved.id, /^[A-Za-z0-9_-]{12}$/, "a short id nobody can guess");
  assert.deepEqual(sessions.list().map((s) => s.attached), [false]);

  const out = sink();
  sessions.attach(reserved.id, out);
  assert.equal(lib.spawned.length, 1, "the shell starts when the stream attaches, not before");
  assert.deepEqual(out.frames[0], { t: "open", pid: 4242 });
  assert.deepEqual(sessions.list().map((s) => [s.attached, s.pid]), [[true, 4242]]);

  lib.spawned[0]!.emit("hello\r\n");
  assert.deepEqual(out.frames[1], { t: "out", d: "hello\r\n" });

  sessions.input(reserved.id, "ls\r");
  assert.deepEqual(lib.spawned[0]!.state.written, ["ls\r"]);

  sessions.resize(reserved.id, { cols: 132, rows: 43 });
  assert.deepEqual(lib.spawned[0]!.state.resized, [[132, 43]]);
  // Nonsense sizes keep the size the session had.
  sessions.resize(reserved.id, { cols: 5000, rows: -1 });
  assert.deepEqual(lib.spawned[0]!.state.resized.at(-1), [132, 43]);

  assert.equal(sessions.close(reserved.id, "closed by the panel"), true);
  assert.deepEqual(kills, [4242], "the whole tree is killed");
  assert.equal(lib.spawned[0]!.state.killed, 1);
  assert.deepEqual(out.frames.at(-1), { t: "ended", reason: "closed by the panel" });
  assert.equal(out.closed, true);
  assert.deepEqual(sessions.list(), []);
  assert.equal(sessions.close(reserved.id, "again"), false, "nothing is kept");
});

test("a shell that exits ends the session with its code, and is not killed again", () => {
  const { sessions, lib, kills } = manager();
  const { id } = sessions.open({ cols: 80, rows: 24 });
  const out = sink();
  sessions.attach(id, out);
  lib.spawned[0]!.exit(3);
  assert.deepEqual(out.frames.slice(-2), [
    { t: "exit", code: 3 },
    { t: "ended", reason: "the shell exited with code 3" },
  ]);
  assert.deepEqual(kills, []);
  assert.deepEqual(sessions.list(), []);
  assert.throws(() => sessions.input(id, "x"), TerminalRefusal);
});

test("one stream per session, ever", () => {
  const { sessions } = manager();
  const { id } = sessions.open({ cols: 80, rows: 24 });
  sessions.attach(id, sink());
  assert.throws(
    () => sessions.attach(id, sink()),
    (error: unknown) => error instanceof TerminalRefusal && error.code === "terminal-attached",
  );
  assert.throws(() => sessions.attach("nope", sink()), TerminalRefusal);
  assert.throws(() => sessions.input("nope", "x"), TerminalRefusal);
});

test("the limit counts reserved and live sessions alike, and frees on close", () => {
  const { sessions } = manager({ maxSessions: 1 });
  const first = sessions.open({ cols: 80, rows: 24 });
  assert.throws(
    () => sessions.open({ cols: 80, rows: 24 }),
    (error: unknown) => error instanceof TerminalRefusal && error.code === "terminal-busy" && /1 terminal session at a time/.test(error.message),
  );
  sessions.close(first.id, "done");
  assert.ok(sessions.open({ cols: 80, rows: 24 }).id);
});

test("a reservation nothing attaches to expires", async () => {
  const { sessions } = manager({}, { reservationMs: 30 });
  const { id, expiresAt } = sessions.open({ cols: 80, rows: 24 });
  assert.ok(new Date(expiresAt).getTime() - Date.now() <= 30);
  await sleep(80);
  assert.equal(sessions.has(id), false);
  assert.throws(() => sessions.attach(id, sink()), TerminalRefusal);
});

test("a session idle too long ends, and so does one that has run its maximum", async () => {
  const idle = manager({ idleMs: 40, maxMs: 10_000 });
  const a = idle.sessions.open({ cols: 80, rows: 24 });
  const outA = sink();
  idle.sessions.attach(a.id, outA);
  await sleep(25);
  idle.sessions.input(a.id, "k"); // typing keeps it alive
  await sleep(25);
  assert.equal(idle.sessions.has(a.id), true, "input reset the idle clock");
  await sleep(60);
  assert.deepEqual(outA.frames.at(-1), { t: "ended", reason: "the session was idle too long" });
  assert.deepEqual(idle.kills, [4242]);

  const long = manager({ idleMs: 10_000, maxMs: 40 });
  const b = long.sessions.open({ cols: 80, rows: 24 });
  const outB = sink();
  long.sessions.attach(b.id, outB);
  await sleep(90);
  assert.deepEqual(outB.frames.at(-1), { t: "ended", reason: "the session reached its maximum length" });
});

test("closing everything ends reserved and live sessions with the reason", () => {
  const { sessions, kills } = manager();
  const live = sessions.open({ cols: 80, rows: 24 });
  const out = sink();
  sessions.attach(live.id, out);
  sessions.open({ cols: 80, rows: 24 });
  sessions.closeAll("the agent is stopping");
  assert.deepEqual(sessions.list(), []);
  assert.deepEqual(out.frames.at(-1), { t: "ended", reason: "the agent is stopping" });
  assert.deepEqual(kills, [4242]);
});

test("an input frame over the bound is refused, not written", () => {
  const { sessions, lib } = manager();
  const { id } = sessions.open({ cols: 80, rows: 24 });
  sessions.attach(id, sink());
  assert.throws(() => sessions.input(id, "x".repeat(MAX_FRAME_BYTES + 1)), /too large/);
  assert.deepEqual(lib.spawned[0]!.state.written, []);
});

test("the shell's environment carries nothing of the agent's", () => {
  const env = shellEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/x",
    GEEBOARD_DAEMON_TOKEN: "secret",
    geeboard_panel_url: "https://panel",
    NODE_EXTRA_CA_CERTS: "/etc/geeboard/panel-ca.crt",
    npm_config_cache: "/tmp",
    LOG_LEVEL: "debug",
  });
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/x", TERM: "xterm-256color", COLORTERM: "truecolor" });
});

test("a shell's descendants are found by parentage, not by process group", async () => {
  /* A /proc made of files: 100 is the shell, 101 its foreground child, 102 a
     background job in a group of its own, 103 that job's child; 200 belongs
     to somebody else. A comm with spaces and a ")" in it must not confuse
     the parsing. */
  const proc = await mkdtemp(path.join(tmpdir(), "geeboard-proc-"));
  const stat = async (pid: number, comm: string, ppid: number) => {
    await mkdir(path.join(proc, String(pid)));
    await writeFile(path.join(proc, String(pid), "stat"), `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1 4194560 0 0 0 0\n`);
  };
  await stat(1, "init", 0);
  await stat(100, "sh", 1);
  await stat(101, "vi", 100);
  await stat(102, "sleep (300)", 100);
  await stat(103, "sh -c x", 102);
  await stat(200, "other", 1);
  await writeFile(path.join(proc, "meminfo"), "not a process\n");
  try {
    assert.deepEqual(descendantsOf(100, proc).sort(), [101, 102, 103]);
    assert.deepEqual(descendantsOf(103, proc), []);
    assert.deepEqual(descendantsOf(999, proc), []);
    assert.deepEqual(descendantsOf(100, path.join(proc, "nowhere")), [], "no /proc, no descendants, no throw");
  } finally {
    await rm(proc, { recursive: true, force: true });
  }
});

test("sizes are whole, bounded, and fall back rather than fail", () => {
  assert.deepEqual(sizeOf({ cols: 120, rows: 40 }), { cols: 120, rows: 40 });
  assert.deepEqual(sizeOf({ cols: "120", rows: 40.5 }), { cols: 80, rows: 24 });
  assert.deepEqual(sizeOf({ cols: 0, rows: 9999 }, { cols: 100, rows: 30 }), { cols: 100, rows: 30 });
  assert.deepEqual(sizeOf({}), { cols: 80, rows: 24 });
});

/* ── A real shell, through the real library ───────────────────────
   Node's own REPL stands in for the shell: it is on every machine this
   runs on, it reads a line and answers, and it can say how wide its
   terminal is. What is proved is the library, the PTY, the resize and
   the kill — the same path PowerShell or bash takes. */

const pty = loadPty();
const REAL = { skip: pty.reason ? `no PTY on this machine: ${pty.reason}` : false };

/* What a terminal prints, minus how it prints it: a real PTY repaints,
   moves the cursor and colours, and a test reads the words. */
function plain(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "");
}

/** The REPL says how wide its terminal is right now, straight from the console, not from a cached value. */
const WIDTH = "process.stdout.getWindowSize()[0]\r";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, label: string, ms = 8_000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (check()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("a real shell answers, resizes, and leaves no process behind", REAL, async () => {
  const sessions = new TerminalSessions({ ...ON, shell: process.execPath }, pty);
  const { id } = sessions.open({ cols: 100, rows: 30 });
  const out = sink();
  const text = () => out.frames.filter((f) => f.t === "out").map((f) => f.d).join("");
  sessions.attach(id, out);
  const pid = (out.frames[0] as { pid: number }).pid;
  assert.ok(alive(pid), "the shell is running");

  // Typed before the REPL is ready: the console keeps it, which is what a person's first keystrokes rely on.
  sessions.input(id, WIDTH);
  await until(() => /\b100\b/.test(plain(text())), "the initial width");

  const before = text().length;
  sessions.resize(id, { cols: 132, rows: 43 });
  await sleep(300);
  sessions.input(id, WIDTH);
  await until(() => /\b132\b/.test(plain(text().slice(before))), "the width after resize");

  // A grandchild the shell started, which a kill of the shell alone would orphan.
  const mark = text().length;
  sessions.input(
    id,
    "'PID:' + require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], {stdio: 'ignore'}).pid + ':'\r",
  );
  await until(() => /PID:\d+:/.test(plain(text().slice(mark))), "the grandchild's pid");
  const grandchild = Number(/PID:(\d+):/.exec(plain(text().slice(mark)))![1]);
  assert.ok(Number.isInteger(grandchild) && alive(grandchild), `grandchild ${grandchild} is running`);

  sessions.close(id, "closed by the test");
  assert.deepEqual(out.frames.at(-1), { t: "ended", reason: "closed by the test" });
  await until(() => !alive(pid), "the shell to be gone");
  await until(() => !alive(grandchild), "the grandchild to be gone", 6_000);
  assert.deepEqual(sessions.list(), []);
});

/* ── The agent's routes and stream ────────────────────────────────
   The real agent, started twice: once with the terminal on, once as it
   comes. Without Docker on the machine /health is a 503 and every route
   here still answers, which is the point of keeping the terminal apart
   from the engine. */

const TOKEN = "terminal-test-token-that-is-long-enough-x";
const PORT_ON = 8600 + Math.floor(Math.random() * 90);
const PORT_OFF = PORT_ON + 100;
const daemonDir = path.join(import.meta.dirname, "..");
let agentOn: ChildProcess | undefined;
let agentOff: ChildProcess | undefined;
let dataRoot: string;

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^GEEBOARD_/i.test(key)) env[key] = value;
  return env;
}

function startAgent(port: number, extra: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: daemonDir,
    env: {
      ...cleanEnvironment(),
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(port),
      GEEBOARD_DAEMON_HOST: "127.0.0.1",
      GEEBOARD_NODE_NAME: "terminal-test",
      GEEBOARD_DATA_ROOT: dataRoot,
      LOG_LEVEL: "error",
      ...extra,
    },
    stdio: "ignore",
  });
}

const api = (port: number, route: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });

async function ready(port: number) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`the agent on ${port} did not start`);
}

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-terminal-"));
  if (REAL.skip) return;
  agentOn = startAgent(PORT_ON, { GEEBOARD_TERMINAL: "1", GEEBOARD_TERMINAL_SHELL: process.execPath });
  agentOff = startAgent(PORT_OFF, {});
  await Promise.all([ready(PORT_ON), ready(PORT_OFF)]);
});

after(async () => {
  agentOn?.kill();
  agentOff?.kill();
  await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
});

/** Frames from a terminal stream as they arrive, and a way to wait for one. */
function follow(ws: WebSocket) {
  const frames: TerminalFrameOut[] = [];
  let closedWith: number | null = null;
  ws.on("message", (raw) => frames.push(JSON.parse(String(raw)) as TerminalFrameOut));
  ws.on("close", (code) => {
    closedWith = code;
  });
  const text = () => frames.filter((f) => f.t === "out").map((f) => f.d).join("");
  return {
    frames,
    text,
    closed: () => closedWith,
    wait: (check: () => boolean, label: string) => until(check, label),
  };
}

test("the routes refuse what they should: no token, a query token, an unknown session, a body over the bound", REAL, async () => {
  assert.equal((await fetch(`http://127.0.0.1:${PORT_ON}/terminal`)).status, 401);
  assert.equal((await api(PORT_ON, "/terminal/nope", { method: "DELETE" })).status, 404);

  const big = await api(PORT_ON, "/terminal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: 80, rows: 24, padding: "x".repeat(70 * 1024) }),
  });
  assert.equal(big.status, 413);

  // The stream takes the token in the header and nowhere else.
  const byQuery = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/nope/stream?token=${TOKEN}`);
  const refusedQuery = await new Promise<string>((resolve) => byQuery.once("error", (e) => resolve(e.message)));
  assert.match(refusedQuery, /401/);

  const unknown = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/nope/stream`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const refusedUnknown = await new Promise<string>((resolve) => unknown.once("error", (e) => resolve(e.message)));
  assert.match(refusedUnknown, /404/);
});

test("an agent nobody switched on says off, in /version and in a refusal with a code", REAL, async () => {
  const version = (await (await api(PORT_OFF, "/version")).json()) as { terminal: { state: string; shell: string; user: string } };
  assert.equal(version.terminal.state, "off");
  assert.ok(version.terminal.shell && version.terminal.user);

  const refused = await api(PORT_OFF, "/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(refused.status, 403);
  assert.equal(((await refused.json()) as { code: string }).code, "terminal-off");
});

test("a session over the wire: open, attach, type, resize, a frame too big, close, nothing left", REAL, async () => {
  const opened = await api(PORT_ON, "/terminal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "terminal-test-0001" },
    body: JSON.stringify({ cols: 100, rows: 30 }),
  });
  assert.equal(opened.status, 201);
  const { id, terminal } = (await opened.json()) as { id: string; terminal: { state: string; scope: string } };
  assert.equal(terminal.state, "on");

  let listed = (await (await api(PORT_ON, "/terminal")).json()) as { sessions: Array<{ id: string; attached: boolean; pid: number | null }> };
  assert.deepEqual(listed.sessions.map((s) => [s.id, s.attached]), [[id, false]]);

  const ws = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/${id}/stream?cols=100&rows=30`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const stream = follow(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await stream.wait(() => stream.frames[0]?.t === "open", "the open frame");
  const pid = (stream.frames[0] as { pid: number }).pid;
  assert.ok(alive(pid));

  listed = (await (await api(PORT_ON, "/terminal")).json()) as typeof listed;
  assert.deepEqual(listed.sessions.map((s) => [s.attached, s.pid]), [[true, pid]]);

  ws.send(JSON.stringify({ t: "in", d: WIDTH }));
  await stream.wait(() => /\b100\b/.test(plain(stream.text())), "width 100");

  const before = stream.text().length;
  ws.send(JSON.stringify({ t: "resize", cols: 132, rows: 43 }));
  await sleep(300);
  ws.send(JSON.stringify({ t: "in", d: WIDTH }));
  await stream.wait(() => /\b132\b/.test(plain(stream.text().slice(before))), "width 132 after resize");

  // A second stream on a session that has one is turned away, and the first goes on.
  const second = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/${id}/stream`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const secondStream = follow(second);
  await secondStream.wait(() => secondStream.closed() !== null, "the second stream to be closed");
  assert.equal(secondStream.frames.at(-1)?.t, "ended");
  assert.equal(stream.closed(), null, "the first stream is untouched");

  ws.send(JSON.stringify({ t: "close" }));
  await stream.wait(() => stream.closed() !== null, "the stream to close");
  assert.deepEqual(stream.frames.at(-1), { t: "ended", reason: "closed by the panel" });
  await until(() => !alive(pid), "the shell to be gone");
  listed = (await (await api(PORT_ON, "/terminal")).json()) as typeof listed;
  assert.deepEqual(listed.sessions, []);
});

test("a frame over the bound closes the stream, and the shell with it", REAL, async () => {
  const { id } = (await (
    await api(PORT_ON, "/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  ).json()) as { id: string };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/${id}/stream`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const stream = follow(ws);
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  await stream.wait(() => stream.frames[0]?.t === "open", "the open frame");
  const pid = (stream.frames[0] as { pid: number }).pid;

  ws.send(JSON.stringify({ t: "in", d: "x".repeat(MAX_FRAME_BYTES + 1) }));
  await stream.wait(() => stream.closed() !== null, "the stream to close");
  assert.equal(stream.closed(), 1009, "too big, says the WebSocket");
  await until(() => !alive(pid), "the shell to be gone");
});

test("the panel letting go of the stream ends the shell", REAL, async () => {
  const { id } = (await (
    await api(PORT_ON, "/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  ).json()) as { id: string };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/${id}/stream`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const stream = follow(ws);
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  await stream.wait(() => stream.frames[0]?.t === "open", "the open frame");
  const pid = (stream.frames[0] as { pid: number }).pid;
  ws.terminate();
  await until(() => !alive(pid), "the shell to be gone");
  let sessions: unknown[] = [];
  await until(() => {
    void api(PORT_ON, "/terminal").then(async (res) => {
      sessions = ((await res.json()) as { sessions: unknown[] }).sessions;
    });
    return sessions.length === 0;
  }, "the session to be forgotten");
});

test("an agent that stops takes its shells with it", REAL, async () => {
  const { id } = (await (
    await api(PORT_ON, "/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  ).json()) as { id: string };
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_ON}/terminal/${id}/stream`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const stream = follow(ws);
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  await stream.wait(() => stream.frames[0]?.t === "open", "the open frame");
  const pid = (stream.frames[0] as { pid: number }).pid;

  // SIGTERM where it is a signal; on Windows kill() ends the agent outright, and the pseudo-console goes with it.
  agentOn!.kill("SIGTERM");
  await until(() => agentOn!.exitCode !== null || agentOn!.signalCode !== null, "the agent to exit", 15_000);
  // A pseudo-console torn down with its agent can outlive it by seconds on a busy machine.
  await until(() => !alive(pid), "the shell to be gone", 30_000);
  agentOn = undefined;
});
