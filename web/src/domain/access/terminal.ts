import type { Role } from "@prisma/client";
import { streamRefusal, type StreamRefusal } from "./streams";

/* Whether a terminal may be opened on a node, and what to say when not.

   Pure, so every branch is a unit test: the matrix and the account gate
   first, as for every stream, then the facts about the node the panel
   already keeps — approved, with an agent, and what that agent said
   about its terminal in its last heartbeat. Nothing here talks to a
   node; the operation does, after this has said yes. */

export interface TerminalNodeFacts {
  name: string;
  approvedAt: Date | null;
  daemonUrl: string | null;
  daemonToken: string | null;
  daemon: string;
  /** As reported by the agent, or null from one that never reports it. */
  terminal: {
    state: "on" | "off" | "unavailable";
    reason?: string;
    os: string;
    user: string;
    shell: string;
    scope: "machine" | "container";
  } | null;
}

export type TerminalRefusal =
  | StreamRefusal
  | "node-gone"
  | "node-pending"
  | "no-agent"
  | "agent-old"
  | "terminal-off"
  | "terminal-unavailable";

export type TerminalDecision = { ok: true } | { ok: false; code: TerminalRefusal; message: string };

/** What the person is told, for every refusal — at the open and when a session is closed under them. */
export function terminalMessage(code: TerminalRefusal, node: Pick<TerminalNodeFacts, "name" | "daemon" | "terminal"> | null): string {
  const name = node?.name ?? "this node";
  switch (code) {
    case "signed-out":
      return "You were signed out, so the terminal was closed.";
    case "password":
      return "Your account has to choose its own password before it can open a terminal.";
    case "two-factor":
      return "Your account has to set up two-factor before it can open a terminal.";
    case "forbidden":
      return "Only an owner can open a node's terminal.";
    case "node-gone":
      return `${name} was removed.`;
    case "node-pending":
      return `${name} is waiting for approval; a terminal opens on an approved node only.`;
    case "no-agent":
      return `${name} has no agent attached.`;
    case "agent-old":
      return `${name} runs agent ${node?.daemon ?? "unknown"}, which has no terminal. Upgrade the agent on that machine to 0.3.5 or later.`;
    case "terminal-off":
      return `The terminal is off on ${name}. Somebody at the machine turns it on — GEEBOARD_TERMINAL=1, or the installer's --terminal — and restarts the agent.`;
    case "terminal-unavailable":
      return `${name} allows a terminal but cannot open one: ${node?.terminal?.reason ?? "no reason given"}.`;
  }
}

export function terminalDecision(
  user: { id: string; role: Role; twoFactor: boolean; passwordSetAt: Date | null } | null,
  node: TerminalNodeFacts | null,
): TerminalDecision {
  const refuse = (code: TerminalRefusal): TerminalDecision => ({ ok: false, code, message: terminalMessage(code, node) });
  const stream = streamRefusal(user, "node.terminal", null);
  if (stream) return refuse(stream);
  if (!node) return refuse("node-gone");
  if (!node.approvedAt) return refuse("node-pending");
  if (!node.daemonUrl || !node.daemonToken) return refuse("no-agent");
  if (!node.terminal) return refuse("agent-old");
  if (node.terminal.state === "off") return refuse("terminal-off");
  if (node.terminal.state === "unavailable") return refuse("terminal-unavailable");
  return { ok: true };
}

/* ── Input ordering ───────────────────────────────────────────────
   Keystrokes reach the panel as separate requests, which nothing orders:
   two can cross, and one can be sent twice after a network error. The
   browser numbers them and sends one at a time; the panel takes a number
   once. A number already seen is a repeat, answered as done and not
   typed again. */
export function acceptSequence(last: number, seq: unknown): { accept: boolean; last: number } {
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) return { accept: false, last };
  if (seq <= last) return { accept: false, last };
  return { accept: true, last: seq };
}
