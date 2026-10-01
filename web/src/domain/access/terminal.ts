import type { Role } from "@prisma/client";
import { addressFamily, isPublicAddress } from "../dns/rules";
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
  | "terminal-unavailable"
  | "plain-http";

export type TerminalDecision = { ok: true } | { ok: false; code: TerminalRefusal; message: string };

/* Whether what is typed in a terminal would cross a network in the clear.

   A terminal carries keystrokes and everything the shell prints, passwords
   included, and the panel reaches most agents over plain HTTP. On a private
   network or over the loopback that is the machine's own business. Across
   the Internet it is not, so an agent reached with `http:` at a public
   address gets no terminal; `https:` always may.

   An address the panel cannot place — a name, which resolves to whatever
   somebody's DNS says today — is not known to be private, and is treated as
   public. That is deliberate and it includes `localhost`: a node on the same
   machine is reached by 127.0.0.1. Returns what to say about it, or null
   when the terminal may go ahead. */
export function plainHttpRisk(daemonUrl: string | null | undefined): { host: string; kind: "public" | "name" } | null {
  if (!daemonUrl) return null;
  let url: URL;
  try {
    url = new URL(daemonUrl);
  } catch {
    return { host: daemonUrl, kind: "name" };
  }
  if (url.protocol === "https:") return null;
  // A URL keeps the brackets round an IPv6 literal; the address itself has none.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:") return { host, kind: "name" };
  if (!addressFamily(host)) return { host, kind: "name" };
  return isPublicAddress(host) ? { host, kind: "public" } : null;
}

/** What the person is told, for every refusal — at the open and when a session is closed under them. */
export function terminalMessage(
  code: TerminalRefusal,
  node: (Pick<TerminalNodeFacts, "name" | "daemon" | "terminal"> & { daemonUrl?: string | null }) | null,
): string {
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
    case "plain-http": {
      const risk = plainHttpRisk(node?.daemonUrl);
      const fix = "Put TLS in front of its agent and join the node again with its https address, or reach it by an address on a private network.";
      return risk?.kind === "name"
        ? `${name} is reached over plain HTTP at ${risk.host}, and a name can point anywhere, so the panel cannot tell that this is a private network. Join the node again with its IP address on that network, or put TLS in front of its agent and use its https address.`
        : `${name} is reached over plain HTTP at a public address (${risk?.host ?? "unknown"}), so what is typed in its terminal, passwords included, would cross the network unencrypted. ${fix}`;
    }
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
  // Last: a machine that says no is told so first, and this is about the road to one that says yes.
  if (plainHttpRisk(node.daemonUrl)) return refuse("plain-http");
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
