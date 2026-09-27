import "server-only";
import { randomBytes } from "node:crypto";
import type WebSocket from "ws";

/* The terminal sessions this panel process holds open.

   A session is the panel's socket to the node's agent, and whichever
   browser stream is attached to it right now. The two are not the same
   thing on purpose: a browser stream drops whenever a laptop lid closes,
   and a shell should survive that for a moment. So a stream that goes
   away leaves the session for REATTACH_MS, keeping what the shell
   printed meanwhile, and the same person from the same sign-in may pick
   it up again. Nobody else can, and nothing makes a new shell: a new
   shell is a new open, with a new code.

   In the process's memory, like the attempt limits and the API's rate
   limit, and honest about it — see docs/security.md, "One instance".
   Next's dev server re-evaluates modules on every change, so the map
   lives on globalThis, as the Prisma client does. */

export const REATTACH_MS = 30_000;
/** Output kept for a stream that is not there, before the oldest is dropped. */
const BUFFER_BYTES = 64 * 1024;

export interface TerminalSession {
  /** The panel's id, the one a browser holds. Not the agent's. */
  id: string;
  /** The agent's id for the same session. */
  agentId: string;
  node: { id: string; name: string; daemonUrl: string; daemonToken: string };
  userId: string;
  userName: string;
  /** The sign-in that opened it; a stream from any other is refused. */
  sessionId: string;
  size: { cols: number; rows: number };
  openedAt: number;
  /** What the agent said when the shell started. */
  shell: { user: string; program: string; os: string; scope: "machine" | "container"; pid: number | null };
  upstream: WebSocket | null;
  /** The browser stream attached now, as a function that writes one event to it. */
  sink: ((event: string, data: unknown) => void) | null;
  buffered: string[];
  bufferedBytes: number;
  dropped: boolean;
  lastSeq: number;
  bytesIn: number;
  bytesOut: number;
  reattach: NodeJS.Timeout | null;
  ended: boolean;
}

const store = globalThis as unknown as { geeboardTerminals?: Map<string, TerminalSession> };
const sessions = (store.geeboardTerminals ??= new Map<string, TerminalSession>());

export function newTerminalId(): string {
  return randomBytes(12).toString("base64url");
}

export function rememberTerminal(session: TerminalSession): void {
  sessions.set(session.id, session);
}

export function terminalById(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function forgetTerminal(id: string): void {
  sessions.delete(id);
}

export function openTerminals(): TerminalSession[] {
  return [...sessions.values()];
}

/** Hands output to the stream, or keeps it for the one that comes back. */
export function deliver(session: TerminalSession, data: string): void {
  session.bytesOut += Buffer.byteLength(data);
  if (session.sink) {
    session.sink("out", { d: data });
    return;
  }
  session.buffered.push(data);
  session.bufferedBytes += Buffer.byteLength(data);
  while (session.bufferedBytes > BUFFER_BYTES && session.buffered.length > 1) {
    session.bufferedBytes -= Buffer.byteLength(session.buffered.shift()!);
    session.dropped = true;
  }
}

/** What a returning stream is given first: everything the shell printed while nobody watched. */
export function replay(session: TerminalSession): { d: string; dropped: boolean } {
  const out = { d: session.buffered.join(""), dropped: session.dropped };
  session.buffered = [];
  session.bufferedBytes = 0;
  session.dropped = false;
  return out;
}
