import type { NodeHealth } from "./compatibility";

/* Node health, as a function of time rather than of one request.

   The naive version — a failed poll means the node is down — is wrong in
   the way that matters most: it is wrong during exactly the five seconds
   somebody is looking at the dashboard during a network blip. A dropped
   packet, a restarting agent and a dead machine all produce the same
   failed request, and only one of them is worth waking somebody for.

   So health decays with silence instead. Missing one poll is nothing;
   missing thirty seconds is worth showing; missing two minutes is worth
   believing. */

/** Silence beyond this and the node is degraded — visible, not alarming. */
export const DEGRADED_AFTER_MS = 30_000;

/** Silence beyond this and the node is treated as gone. */
export const UNREACHABLE_AFTER_MS = 120_000;

/* States an operator chose. A successful ping does not clear them, and
   silence does not deepen them — a node under maintenance is not
   "unreachable", it is switched off on purpose, and reporting it as a
   fault would train people to ignore the one that is real. */
const OPERATOR_OWNED: ReadonlySet<NodeHealth> = new Set<NodeHealth>([
  "DRAINING",
  "MAINTENANCE",
  "PENDING",
]);

export interface HealthInput {
  current: NodeHealth;
  /** Last time the panel heard from the node, by any route. */
  lastSeenAt: Date | null;
  /** Whether the most recent attempt to reach it worked. */
  reachable: boolean;
  now?: Date;
}

export interface HealthOutcome {
  state: NodeHealth;
  /** True when the state changed and is worth recording. */
  changed: boolean;
  /** How long the node has been silent, in milliseconds. */
  silentForMs: number;
  /** Worth an activity event, and what to call it. */
  event: { action: string; tone: "DANGER" | "WARNING" | "SUCCESS" } | null;
}

export function assessHealth(input: HealthInput): HealthOutcome {
  const now = input.now ?? new Date();
  const silentForMs = input.lastSeenAt ? now.getTime() - input.lastSeenAt.getTime() : Infinity;

  if (OPERATOR_OWNED.has(input.current)) {
    return { state: input.current, changed: false, silentForMs, event: null };
  }

  const next = decide(input.reachable, silentForMs);
  if (next === input.current) {
    return { state: next, changed: false, silentForMs, event: null };
  }

  return { state: next, changed: true, silentForMs, event: eventFor(input.current, next) };
}

function decide(reachable: boolean, silentForMs: number): NodeHealth {
  /* A node we have just spoken to is healthy, whatever it was a moment
     ago. Recovery is immediate; only the decline is gradual. */
  if (reachable) return "HEALTHY";

  if (silentForMs >= UNREACHABLE_AFTER_MS) return "UNREACHABLE";
  if (silentForMs >= DEGRADED_AFTER_MS) return "DEGRADED";

  /* Unreachable this instant but heard from seconds ago. Almost always a
     blip, and saying nothing is the right answer to a blip. */
  return "HEALTHY";
}

function eventFor(from: NodeHealth, to: NodeHealth): HealthOutcome["event"] {
  if (to === "UNREACHABLE") return { action: "node.unreachable", tone: "DANGER" };
  if (to === "DEGRADED") return { action: "node.degraded", tone: "WARNING" };
  if (to === "HEALTHY" && (from === "UNREACHABLE" || from === "DEGRADED")) {
    return { action: "node.recovered", tone: "SUCCESS" };
  }
  return null;
}

/** How the silence reads in the UI. */
export function silenceLabel(silentForMs: number): string {
  if (!Number.isFinite(silentForMs)) return "never heard from";
  const seconds = Math.round(silentForMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
