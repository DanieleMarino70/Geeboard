import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import process from "node:process";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { operatingSystem } from "./capabilities.ts";
import { logger } from "./log.ts";

/* A shell of the machine the agent runs on, opened from the panel.

   Everything else this agent does is aimed at a game's container. This
   runs a program on the machine itself, as the account the agent runs
   as, which is why it is off until somebody on that machine turns it on
   (config.ts, GEEBOARD_TERMINAL) and why the panel asks more of whoever
   opens one than of anyone watching a console.

   What "the machine" is depends on how the agent was installed. On
   Windows the agent is a scheduled task in the account that installed
   it, and a shell here is that account's PowerShell. On Linux the
   supported install runs the agent in a container, and a shell here is
   a shell inside that container: it sees the agent's own files and
   mounts, not the host's. The descriptor says which one it is, and the
   panel shows it.

   The agent decides nothing about who may open a shell — the panel
   does, before it ever calls here. What the agent decides is what a
   session may cost the machine: how many at once, how long idle, how
   long at most, and that every process a session started is gone when
   it ends. */

export type TerminalState = "on" | "off" | "unavailable";
export type TerminalScope = "machine" | "container";

/** What this node says about its terminal, in every heartbeat and in /version. */
export interface TerminalDescriptor {
  state: TerminalState;
  /** Why it is unavailable, when it is. */
  reason?: string;
  /** The host's operating system — not the engine's, which is what the node's `os` is. */
  os: string;
  /** The account a shell would run as. */
  user: string;
  /** The program a shell would be, as configured on the machine. */
  shell: string;
  scope: TerminalScope;
}

export interface TerminalPolicy {
  /** GEEBOARD_TERMINAL, or the `terminal` key join wrote. Off unless somebody said so. */
  enabled: boolean;
  /** GEEBOARD_TERMINAL_SHELL, or the platform's own. */
  shell: string | null;
  maxSessions: number;
  idleMs: number;
  maxMs: number;
}

export const DEFAULT_POLICY: Omit<TerminalPolicy, "enabled" | "shell"> = {
  maxSessions: 2,
  idleMs: 15 * 60_000,
  maxMs: 4 * 60 * 60_000,
};

/* A session the panel has asked for but not yet attached to lives this
   long. The panel opens a session with one request and attaches its
   stream with the next; a reservation nothing ever attached to must not
   hold a slot. */
export const RESERVATION_MS = 30_000;
/** One frame, either way. The same bound as a JSON body on this agent. */
export const MAX_FRAME_BYTES = 64 * 1024;
const MAX_COLS = 1000;
const MAX_ROWS = 500;

/** Refused, and the panel is told why in a word it can act on. */
export class TerminalRefusal extends Error {
  constructor(
    readonly code: "terminal-off" | "terminal-unavailable" | "terminal-busy" | "terminal-attached",
    message: string,
  ) {
    super(message);
  }
}

/* ── The PTY library ───────────────────────────────────────────────
   Loaded by hand, once, so a machine where the binary is missing says
   so in its descriptor rather than failing the first person who opens a
   terminal. On Windows the library loads its binding at the first
   spawn, so being able to require it proves nothing there; the binary's
   presence on disk does. */

type PtySpawn = (file: string, args: string[], options: {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string | undefined>;
}) => IPty;

export interface PtyLibrary {
  spawn: PtySpawn;
}

export function loadPty(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { library: PtyLibrary; reason?: undefined } | { library?: undefined; reason: string } {
  const require = createRequire(import.meta.url);
  let library: PtyLibrary;
  let root: string;
  try {
    library = require("@homebridge/node-pty-prebuilt-multiarch") as PtyLibrary;
    root = path.dirname(require.resolve("@homebridge/node-pty-prebuilt-multiarch/package.json"));
  } catch (error) {
    return {
      reason:
        "the PTY library is not installed on this machine: it is an optional download (from github.com, on Windows) made when the " +
        "agent's packages are installed, and that install could not get it. Everything but the terminal works without it; run " +
        `npm install in the agent's folder again with access to github.com to add it (${(error as Error).message.split("\n")[0]})`,
    };
  }
  if (platform === "win32") {
    const built = path.join(root, "build", "Release", "conpty.node");
    const prebuilt = path.join(root, "prebuilds", `win32-${arch}`, "conpty.node");
    if (!existsSync(built) && !existsSync(prebuilt)) {
      return {
        reason:
          "the PTY library's Windows binary is missing: it is downloaded when the agent's packages are installed, " +
          "so run the installer again on this machine with access to github.com",
      };
    }
  }
  return { library };
}

/* ── What the shell is ─────────────────────────────────────────────
   The panel never names the program. It is the platform's, or what the
   operator set on the machine — and a setting that names a program that
   is not there makes the terminal unavailable rather than something else. */

export function defaultShell(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "win32") {
    return path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

function shellArguments(shell: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" && /powershell\.exe$|pwsh\.exe$/i.test(shell) ? ["-NoLogo"] : [];
}

/** The account the agent runs as, as a shell would report it. */
export function accountName(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return userInfo().username;
  } catch {
    // A container whose uid has no passwd entry: say the number rather than nothing.
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    return env.USERNAME ?? env.USER ?? (uid === null ? "unknown" : `uid ${uid}`);
  }
}

export function terminalScope(platform: NodeJS.Platform = process.platform): TerminalScope {
  // Docker writes this file into every container it starts.
  return platform !== "win32" && existsSync("/.dockerenv") ? "container" : "machine";
}

/* The environment a shell starts with: the agent's, minus the agent's
   own. The token, the panel's address and everything else the agent
   was told are not the shell's business, and a shell that prints its
   environment must not print them. */
export function shellEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(GEEBOARD_|NODE_|npm_|LOG_)/i.test(key)) continue;
    out[key] = value;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  return out;
}

export function describeTerminal(
  policy: Pick<TerminalPolicy, "enabled" | "shell">,
  pty: { reason?: string },
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): TerminalDescriptor {
  const shell = policy.shell ?? defaultShell(platform, env);
  const base = { os: operatingSystem(), user: accountName(env), shell, scope: terminalScope(platform) };
  if (!policy.enabled) return { state: "off", ...base };
  if (pty.reason) return { state: "unavailable", reason: pty.reason, ...base };
  if (policy.shell) {
    try {
      if (!statSync(policy.shell).isFile()) throw new Error("not a file");
    } catch {
      return { state: "unavailable", reason: `GEEBOARD_TERMINAL_SHELL names ${policy.shell}, which is not on this machine`, ...base };
    }
  }
  return { state: "on", ...base };
}

/* ── Killing what a session started ────────────────────────────────
   A shell's children must go with it. On Windows the pseudo-console's
   close ends what is attached to it, but a program the shell started in
   a window of its own is not attached; taskkill follows parentage
   instead. On Unix a shell with job control puts every background job in
   a process group of its own — `sleep 300 &` in ash or bash is not in
   the shell's group — so the group is not the tree either; parentage
   is, read from /proc. A hang-up first, the way a closed terminal ends a
   shell, then, for whatever is still there, the kill nothing survives. */
export function descendantsOf(pid: number, proc = "/proc"): number[] {
  const children = new Map<number, number[]>();
  let entries: string[];
  try {
    entries = readdirSync(proc);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(path.join(proc, entry, "stat"), "utf8");
    } catch {
      continue;
    }
    // "pid (comm) state ppid …" — comm may hold spaces and parentheses, so split after the last ")".
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const parent = Number(after[1]);
    if (!Number.isInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), Number(entry)]);
  }
  const found: number[] = [];
  const queue = [pid];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (found.includes(child)) continue;
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  const signal = (target: number, name: NodeJS.Signals) => {
    try {
      process.kill(target, name);
    } catch {
      /* already gone */
    }
  };
  const sweep = (name: NodeJS.Signals) => {
    const tree = descendantsOf(pid);
    // The shell's own group first (the library made it a session leader), then every descendant by pid.
    signal(-pid, name);
    for (const child of tree) signal(child, name);
    signal(pid, name);
  };
  sweep("SIGHUP");
  const finish = setTimeout(() => sweep("SIGKILL"), 3_000);
  finish.unref();
}

/* ── Sessions ──────────────────────────────────────────────────────
   Two steps, like the panel uses them: `open` reserves a session and
   answers with its id; `attach` starts the shell and binds it to the
   stream the panel opened. The shell is not started before something is
   there to read it, so nothing runs unwatched and nothing is buffered. */

export interface TerminalFrameOut {
  t: "open" | "out" | "exit" | "ended";
  d?: string;
  pid?: number;
  code?: number;
  signal?: number;
  reason?: string;
}

/** The stream a session writes to: the panel's WebSocket, or a test's array. */
export interface TerminalSink {
  send(frame: TerminalFrameOut): void;
  close(): void;
}

export interface TerminalSessionInfo {
  id: string;
  openedAt: string;
  attached: boolean;
  pid: number | null;
}

interface Session {
  id: string;
  openedAt: number;
  requestId?: string;
  cols: number;
  rows: number;
  pty: IPty | null;
  sink: TerminalSink | null;
  reservation: NodeJS.Timeout | null;
  idle: NodeJS.Timeout | null;
  deadline: NodeJS.Timeout | null;
  closing: boolean;
}

export function sizeOf(raw: { cols?: unknown; rows?: unknown }, fallback = { cols: 80, rows: 24 }): { cols: number; rows: number } {
  const clamp = (value: unknown, max: number, or: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : or;
  return { cols: clamp(raw.cols, MAX_COLS, fallback.cols), rows: clamp(raw.rows, MAX_ROWS, fallback.rows) };
}

export class TerminalSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly platform: NodeJS.Platform;
  private readonly kill: (pid: number) => void;
  private readonly env: NodeJS.ProcessEnv;
  private readonly reservationMs: number;

  constructor(
    private readonly policy: TerminalPolicy,
    private readonly pty: { library?: PtyLibrary; reason?: string },
    options: { platform?: NodeJS.Platform; killTree?: (pid: number) => void; env?: NodeJS.ProcessEnv; reservationMs?: number } = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.kill = options.killTree ?? ((pid) => killTree(pid, this.platform));
    this.env = options.env ?? process.env;
    this.reservationMs = options.reservationMs ?? RESERVATION_MS;
  }

  describe(): TerminalDescriptor {
    return describeTerminal(this.policy, this.pty, this.platform, this.env);
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      openedAt: new Date(s.openedAt).toISOString(),
      attached: s.pty !== null,
      pid: s.pty?.pid ?? null,
    }));
  }

  /** A session the panel may attach to within RESERVATION_MS. */
  open(size: { cols: number; rows: number }, requestId?: string): { id: string; expiresAt: string } {
    const described = this.describe();
    if (described.state === "off") {
      throw new TerminalRefusal("terminal-off", "the terminal is off on this node; turn it on on the machine (GEEBOARD_TERMINAL=1, or the installer's --terminal) and restart the agent");
    }
    if (described.state === "unavailable") {
      throw new TerminalRefusal("terminal-unavailable", described.reason ?? "the terminal is not available on this node");
    }
    if (this.sessions.size >= this.policy.maxSessions) {
      throw new TerminalRefusal("terminal-busy", `this node allows ${this.policy.maxSessions} terminal session${this.policy.maxSessions === 1 ? "" : "s"} at a time, and they are all open`);
    }

    const id = randomBytes(9).toString("base64url");
    const session: Session = {
      id,
      openedAt: Date.now(),
      requestId,
      ...sizeOf(size),
      pty: null,
      sink: null,
      reservation: null,
      idle: null,
      deadline: null,
      closing: false,
    };
    session.reservation = setTimeout(() => this.end(session, "never attached"), this.reservationMs);
    session.reservation.unref();
    this.sessions.set(id, session);
    logger.info("terminal session reserved", { requestId, session: id });
    return { id, expiresAt: new Date(session.openedAt + this.reservationMs).toISOString() };
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Starts the shell and binds it to the stream. One stream per session, ever. */
  attach(id: string, sink: TerminalSink, size?: { cols?: unknown; rows?: unknown }): void {
    const session = this.sessions.get(id);
    if (!session) throw new TerminalRefusal("terminal-unavailable", "no such terminal session; it may have expired");
    if (session.pty || session.sink) throw new TerminalRefusal("terminal-attached", "that terminal session already has its stream");
    const library = this.pty.library;
    if (!library) throw new TerminalRefusal("terminal-unavailable", this.pty.reason ?? "the terminal is not available on this node");

    if (session.reservation) clearTimeout(session.reservation);
    session.reservation = null;
    if (size) Object.assign(session, sizeOf(size, session));

    const shell = this.policy.shell ?? defaultShell(this.platform, this.env);
    let pty: IPty;
    try {
      pty = library.spawn(shell, shellArguments(shell, this.platform), {
        name: "xterm-256color",
        cols: session.cols,
        rows: session.rows,
        cwd: homedir(),
        env: shellEnvironment(this.env),
      });
    } catch (error) {
      this.sessions.delete(id);
      const message = error instanceof Error ? error.message : "unknown error";
      logger.error("terminal shell failed to start", { requestId: session.requestId, session: id, shell, detail: message });
      throw new TerminalRefusal("terminal-unavailable", `the shell could not be started: ${message}`);
    }

    session.pty = pty;
    session.sink = sink;
    session.openedAt = Date.now();
    logger.info("terminal session opened", { requestId: session.requestId, session: id, pid: pty.pid, shell });
    sink.send({ t: "open", pid: pty.pid });

    pty.onData((data) => {
      if (!session.closing) session.sink?.send({ t: "out", d: data });
    });
    pty.onExit(({ exitCode, signal }) => {
      if (session.closing) return;
      session.sink?.send({ t: "exit", code: exitCode, ...(signal ? { signal } : {}) });
      this.end(session, `the shell exited with code ${exitCode}`, false);
    });

    session.deadline = setTimeout(() => this.end(session, "the session reached its maximum length"), this.policy.maxMs);
    session.deadline.unref();
    this.touch(session);
  }

  input(id: string, data: string): void {
    const session = this.live(id);
    if (Buffer.byteLength(data) > MAX_FRAME_BYTES) throw new Error("input frame too large");
    session.pty!.write(data);
    this.touch(session);
  }

  resize(id: string, size: { cols?: unknown; rows?: unknown }): void {
    const session = this.live(id);
    Object.assign(session, sizeOf(size, session));
    session.pty!.resize(session.cols, session.rows);
    this.touch(session);
  }

  close(id: string, reason: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.end(session, reason);
    return true;
  }

  /** Every session, when the agent stops. Nothing survives a restart. */
  closeAll(reason: string): void {
    for (const session of [...this.sessions.values()]) this.end(session, reason);
  }

  private live(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || !session.pty || session.closing) throw new TerminalRefusal("terminal-unavailable", "no such terminal session");
    return session;
  }

  /* Idle is measured on the panel's side of the conversation: a shell
     left printing to nobody is still idle. */
  private touch(session: Session): void {
    if (session.idle) clearTimeout(session.idle);
    session.idle = setTimeout(() => this.end(session, "the session was idle too long"), this.policy.idleMs);
    session.idle.unref();
  }

  private end(session: Session, reason: string, killShell = true): void {
    if (session.closing) return;
    session.closing = true;
    this.sessions.delete(session.id);
    for (const timer of [session.reservation, session.idle, session.deadline]) if (timer) clearTimeout(timer);

    const pid = session.pty?.pid ?? null;
    if (session.pty && killShell) {
      this.kill(session.pty.pid);
      try {
        session.pty.kill();
      } catch {
        /* already gone */
      }
    }
    try {
      session.sink?.send({ t: "ended", reason });
      session.sink?.close();
    } catch {
      /* the stream is what failed */
    }
    logger.info("terminal session closed", {
      requestId: session.requestId,
      session: session.id,
      pid,
      reason,
      durationMs: Date.now() - session.openedAt,
    });
  }
}
