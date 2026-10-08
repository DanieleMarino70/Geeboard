import "server-only";
import type { EventTone, User } from "@prisma/client";
import WebSocket from "ws";
import { streamRefusal } from "@/domain/access/streams";
import { acceptSequence, inFrames, terminalDecision, terminalMessage, type TerminalNodeFacts } from "@/domain/access/terminal";
import { runtimeFor } from "@/domain/runtime/docker";
import { verifyFreshCodeOp } from "./account-ops";
import { attempt } from "./attempts";
import { AgentError } from "./daemon-client";
import { db } from "./db";
import { logger } from "./log";
import { terminalOf } from "./node-ops";
import type { OpResult } from "./server-ops";
import {
  REATTACH_MS,
  deliver,
  forgetTerminal,
  newTerminalId,
  rememberTerminal,
  replay,
  terminalById,
  type TerminalSession,
} from "./terminal-sessions";

/* The node terminal, on the panel's side.

   Opening one is the privileged act in this codebase: the panel decides
   who, the machine decided whether (docs/nodes.md, "Node terminal"), and
   the agent runs the shell. So the open asks more than any page does —
   the owner's role, and a fresh code from their authenticator — and the
   session stays tied to the sign-in that opened it: another sign-in of
   the same account gets nothing, and the sign-in ending closes the shell
   within STREAM_RECHECK_MS, like a console.

   What is never here: what was typed or printed. The audit log gets a
   session opened and closed, on which node, by whom, for how long, how
   many bytes each way, and why it ended. */

/** One frame per byte size, the agent's bound; a paste larger than this goes in pieces. */
export const TERMINAL_FRAME_BYTES = 64 * 1024;

type Refused = { ok: false; title: string; body: string; code?: string };

function nodeFacts(node: { name: string; approvedAt: Date | null; daemonUrl: string | null; daemonToken: string | null; daemon: string; terminal: unknown }): TerminalNodeFacts {
  return { ...node, terminal: terminalOf(node) };
}

async function record(session: TerminalSession, action: string, tone: EventTone, changes: Record<string, { from: string; to: string }>) {
  await db.activityEvent.create({
    data: { actor: session.userName, action, target: session.node.name, tone, userId: session.userId, changes },
  });
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ── Opening ───────────────────────────────────────────────────────── */

export interface OpenedTerminal {
  ok: true;
  id: string;
  node: string;
  shell: { user: string; program: string; os: string; scope: "machine" | "container" };
}

export async function openTerminalOp(
  actor: User,
  sessionId: string,
  nodeName: string,
  input: { code: string; cols: number; rows: number },
): Promise<OpenedTerminal | Refused> {
  const node = await db.node.findUnique({ where: { name: nodeName.trim().toLowerCase() } });
  const decision = terminalDecision(actor, node ? nodeFacts(node) : null);
  if (!decision.ok) return { ok: false, title: "Cannot open a terminal", body: decision.message, code: decision.code };
  if (!attempt(`terminal-open:${actor.id}`, 10, 60_000)) {
    return { ok: false, title: "Too many attempts", body: "Wait a minute and try again.", code: "busy" };
  }

  const fresh = await verifyFreshCodeOp(actor, input.code);
  if (!fresh.ok) {
    await db.activityEvent.create({
      data: {
        actor: actor.name,
        action: "node.terminal.refused",
        target: node!.name,
        tone: "WARNING",
        userId: actor.id,
        changes: { Reason: { from: "—", to: fresh.title } },
      },
    });
    return { ...fresh, code: "code" };
  }

  const runtime = runtimeFor(node!)!;
  let reserved: Awaited<ReturnType<typeof runtime.terminal.open>>;
  try {
    reserved = await runtime.terminal.open({ cols: input.cols, rows: input.rows });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof AgentError ? error.cause : error;
    const message = cause instanceof AgentError ? cause.message : error instanceof Error ? error.message : "the node did not answer";
    const code = cause instanceof AgentError && cause.status === 404 ? "agent-old" : cause instanceof AgentError && cause.status === null ? "node-unreachable" : "agent";
    return {
      ok: false,
      title: "Cannot open a terminal",
      body: code === "agent-old" ? terminalMessage("agent-old", nodeFacts(node!)) : `${node!.name}: ${message}`,
      code,
    };
  }

  const session: TerminalSession = {
    id: newTerminalId(),
    agentId: reserved.id,
    node: { id: node!.id, name: node!.name, daemonUrl: node!.daemonUrl!, daemonToken: node!.daemonToken! },
    userId: actor.id,
    userName: actor.name,
    sessionId,
    size: { cols: input.cols, rows: input.rows },
    openedAt: Date.now(),
    shell: { user: reserved.terminal.user, program: reserved.terminal.shell, os: reserved.terminal.os, scope: reserved.terminal.scope, pid: null },
    upstream: null,
    sink: null,
    buffered: [],
    bufferedBytes: 0,
    dropped: false,
    lastSeq: -1,
    bytesIn: 0,
    bytesOut: 0,
    reattach: null,
    ended: false,
  };
  rememberTerminal(session);
  // The reservation on the agent is good for thirty seconds; a browser that never attaches lets it lapse there and here alike.
  session.reattach = setTimeout(() => void endTerminal(session, "the browser never attached"), REATTACH_MS);

  await record(session, "node.terminal.opened", "ACCENT", {
    Session: { from: "—", to: session.id.slice(0, 8) },
    Shell: { from: "—", to: `${session.shell.user} · ${session.shell.program}${session.shell.scope === "container" ? " (agent container)" : ""}` },
  });
  logger.info("terminal opened", { node: node!.name, session: session.id, user: actor.id });
  return { ok: true, id: session.id, node: node!.name, shell: session.shell };
}

/* ── The stream ────────────────────────────────────────────────────
   Attaches a browser's stream to a session: the first time, this is
   when the panel opens its socket to the agent, which is when the shell
   starts; later, it is a stream picking the session up again. */

export type Sink = (event: string, data: unknown) => void;

export function attachTerminal(session: TerminalSession, sink: Sink): void {
  if (session.reattach) clearTimeout(session.reattach);
  session.reattach = null;
  session.sink = sink;
  sink("open", { node: session.node.name, shell: session.shell, size: session.size });

  if (session.upstream) {
    const back = replay(session);
    if (back.d || back.dropped) sink("out", { d: back.d, dropped: back.dropped });
    return;
  }

  const runtime = runtimeFor(session.node)!;
  const upstream = runtime.terminal.socket(session.agentId, session.size);
  session.upstream = upstream;

  upstream.on("message", (raw) => {
    let frame: { t?: string; d?: string; pid?: number; code?: number; reason?: string };
    try {
      frame = JSON.parse(String(raw)) as typeof frame;
    } catch {
      return;
    }
    if (frame.t === "open") {
      session.shell.pid = typeof frame.pid === "number" ? frame.pid : null;
      session.sink?.("open", { node: session.node.name, shell: session.shell, size: session.size });
    } else if (frame.t === "out" && typeof frame.d === "string") {
      deliver(session, frame.d);
    } else if (frame.t === "exit") {
      session.sink?.("exit", { code: frame.code ?? null });
    } else if (frame.t === "ended") {
      void endTerminal(session, frame.reason ?? "the node ended the session", { upstreamGone: true });
    }
  });
  upstream.on("error", (error) => {
    void endTerminal(session, `lost the connection to ${session.node.name}: ${error.message}`, { upstreamGone: true });
  });
  upstream.on("close", () => {
    void endTerminal(session, `${session.node.name} closed the session`, { upstreamGone: true });
  });
}

/** The browser stream went away; the shell waits REATTACH_MS for it to come back. */
export function detachTerminal(session: TerminalSession): void {
  if (session.ended) return;
  session.sink = null;
  if (session.reattach) clearTimeout(session.reattach);
  session.reattach = setTimeout(() => void endTerminal(session, "the browser went away"), REATTACH_MS);
}

/* ── Typing, resizing, closing ─────────────────────────────────────── */

function upstreamOf(session: TerminalSession): WebSocket | null {
  return session.upstream && session.upstream.readyState === WebSocket.OPEN ? session.upstream : null;
}

export function terminalInput(session: TerminalSession, seq: unknown, data: unknown): { accepted: boolean; reason?: string } {
  if (typeof data !== "string") return { accepted: false, reason: "no input" };
  if (Buffer.byteLength(data) > TERMINAL_FRAME_BYTES) return { accepted: false, reason: "too much at once" };
  const order = acceptSequence(session.lastSeq, seq);
  if (!order.accept) return { accepted: false, reason: "already typed" };
  const upstream = upstreamOf(session);
  if (!upstream) return { accepted: false, reason: "the shell is not attached" };
  session.lastSeq = order.last;
  session.bytesIn += Buffer.byteLength(data);
  /* In frames the agent will take. The agent closes a connection whose frame is over its bound (65,536 bytes), which kills the shell, and the bound
     was checked on the text typed and not on the JSON that carries it: a carriage return is two bytes there and a control character six, so a paste of
     40,000 lines was 80,000 bytes and ended the session (the audit of 0.9.5). Eight thousand characters is at most 48,000 bytes on the wire. */
  for (const piece of inFrames(data)) upstream.send(JSON.stringify({ t: "in", d: piece }));
  return { accepted: true };
}

export function terminalResize(session: TerminalSession, cols: unknown, rows: unknown): boolean {
  const upstream = upstreamOf(session);
  if (!upstream) return false;
  const clamp = (v: unknown, max: number, or: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : or);
  session.size = { cols: clamp(cols, 1000, session.size.cols), rows: clamp(rows, 500, session.size.rows) };
  upstream.send(JSON.stringify({ t: "resize", ...session.size }));
  return true;
}

export async function endTerminal(
  session: TerminalSession,
  reason: string,
  options: { upstreamGone?: boolean } = {},
): Promise<void> {
  if (session.ended) return;
  session.ended = true;
  forgetTerminal(session.id);
  if (session.reattach) clearTimeout(session.reattach);

  try {
    session.sink?.("ended", { reason });
  } catch {
    /* the stream is what went */
  }
  session.sink = null;

  if (!options.upstreamGone) {
    const upstream = upstreamOf(session);
    if (upstream) {
      try {
        upstream.send(JSON.stringify({ t: "close" }));
        upstream.close(1000);
      } catch {
        /* already closing */
      }
    } else if (!session.upstream || session.upstream.readyState === WebSocket.CONNECTING) {
      // Reserved on the agent and never attached, or attaching right now: let go of the reservation there too.
      await runtimeFor(session.node)?.terminal.close(session.agentId).catch(() => {});
    }
  }
  const handshaking = session.upstream;
  if (handshaking) {
    /* A socket that is still connecting is aborted, and not left to finish: the close landed inside the handshake, the agent then started the shell for a
       socket nobody held, and it lived until its idle timer with the node's session cap taken (the audit of 0.9.5). The error listener that is removed
       just below is put back as one that does nothing, so a handshake that fails is not an error nobody handles. */
    if (handshaking.readyState === WebSocket.CONNECTING) {
      try {
        handshaking.terminate();
      } catch {
        /* already gone */
      }
    }
    handshaking.removeAllListeners();
    handshaking.on("error", () => {});
  }

  const ms = Date.now() - session.openedAt;
  await record(session, "node.terminal.closed", "INFO", {
    Session: { from: "—", to: session.id.slice(0, 8) },
    Duration: { from: "—", to: duration(ms) },
    Reason: { from: "—", to: reason },
    Typed: { from: "—", to: `${session.bytesIn} bytes` },
    Printed: { from: "—", to: `${session.bytesOut} bytes` },
  }).catch(() => {});
  logger.info("terminal closed", { node: session.node.name, session: session.id, reason, ms });
}

/* ── Who may go on ─────────────────────────────────────────────────
   Asked when a stream opens and every STREAM_RECHECK_MS while it runs:
   the sign-in that opened it, the account gate, the owner's role, and
   the node — still there, still approved, still holding the same agent
   token. A rotation ends the session: the socket it holds was opened
   with the old token, and nothing should outlive a token by design. */
export type TerminalAccess = { ok: true } | { ok: false; reason: string };

export async function terminalAccess(session: TerminalSession, presentedSessionId: string | null): Promise<TerminalAccess> {
  if (presentedSessionId !== session.sessionId) return { ok: false, reason: "This terminal belongs to another sign-in." };
  const [user, node] = await Promise.all([
    db.session.findUnique({ where: { id: session.sessionId }, include: { user: true } }).then((s) => (s && s.expiresAt > new Date() ? s.user : null)),
    db.node.findUnique({ where: { id: session.node.id }, select: { name: true, approvedAt: true, daemonUrl: true, daemonToken: true, daemon: true, terminal: true } }),
  ]);
  const stream = streamRefusal(user, "node.terminal", null);
  if (stream) return { ok: false, reason: terminalMessage(stream, node ? nodeFacts(node) : null) };
  if (!node) return { ok: false, reason: terminalMessage("node-gone", { name: session.node.name, daemon: "", terminal: null }) };
  if (!node.approvedAt) return { ok: false, reason: terminalMessage("node-pending", nodeFacts(node)) };
  if (node.daemonToken !== session.node.daemonToken) return { ok: false, reason: `${node.name}'s agent token was rotated, so the terminal was closed.` };
  return { ok: true };
}

/** For the routes: the session a browser names, if it is one this process holds. */
export function terminalSession(id: string): TerminalSession | null {
  return terminalById(id) ?? null;
}

export async function closeTerminalOp(session: TerminalSession): Promise<OpResult> {
  await endTerminal(session, "closed from the panel");
  return { ok: true, tone: "success", title: "Terminal closed", body: `The shell on ${session.node.name} was ended.` };
}
