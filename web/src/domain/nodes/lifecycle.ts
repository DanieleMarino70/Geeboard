/* Where a node is on its way in, from the facts the panel holds.

   The Add a node dialog used to know four things — waiting, registered,
   expired, revoked — and stopped asking at the first of them that would
   not change by itself. So it said *registered* and went quiet while the
   part that decides whether the node will ever take a server was still
   ahead: approval, and the panel's first call back to the machine, which
   is the direction registration does not prove. Everything below is read
   from the node row and the token row; nothing is a timer pretending to
   be a fact. */

export type LifecycleStep =
  /** The token is out; no machine has used it. */
  | "waiting"
  /** The machine registered and is waiting for somebody to approve it. */
  | "pending"
  /** Approved; the panel has not reached the machine on its address yet. */
  | "approved"
  /** Approved and reached: in service. */
  | "online"
  /** Registered, and the panel's call to its address failed. */
  | "unreachable"
  | "expired"
  | "revoked"
  | "gone";

export interface LifecycleFacts {
  state: "waiting" | "expired" | "revoked" | "gone" | "registered";
  expiresAt?: string | Date;
  node?: {
    name: string;
    approved: boolean;
    lastSeenAt: string | Date | null;
    lastReachedAt: string | Date | null;
    reachDetail: string | null;
  };
}

export interface Lifecycle {
  step: LifecycleStep;
  /** One line for the dialog. */
  label: string;
  /** A second line, when there is something to say: how long the token has, why the panel cannot reach it. */
  detail: string | null;
  /** Nothing will change by itself from here: stop asking. */
  done: boolean;
}

/** How recent a call has to be to count as "reached now": the poller's period, with room for one missed pass. */
export const REACHED_WITHIN_MS = 45_000;

function ms(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

export function timeLeft(untilMs: number, nowMs: number): string {
  const left = untilMs - nowMs;
  if (left <= 0) return "expired";
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.round(hours / 24)} days`;
}

export function lifecycleOf(facts: LifecycleFacts, nodeName: string, nowMs = Date.now()): Lifecycle {
  switch (facts.state) {
    case "expired":
      return { step: "expired", label: "This token expired before a machine used it. Close this and create another.", detail: null, done: true };
    case "revoked":
      return { step: "revoked", label: "This token was revoked. Close this and create another.", detail: null, done: true };
    case "gone":
      return { step: "gone", label: "This token, or the node it registered, no longer exists.", detail: null, done: true };
    case "waiting": {
      const expires = ms(facts.expiresAt);
      return {
        step: "waiting",
        label: `Waiting for ${nodeName} to register…`,
        detail: expires === null ? null : `The token is good for ${timeLeft(expires, nowMs)}; the command works once.`,
        done: false,
      };
    }
    case "registered": {
      const node = facts.node!;
      const reached = ms(node.lastReachedAt);
      const reachedNow = reached !== null && nowMs - reached <= REACHED_WITHIN_MS;
      if (node.reachDetail && !reachedNow) {
        return {
          step: "unreachable",
          label: `${node.name} registered, but the panel cannot reach it.`,
          detail: `${node.reachDetail} Open that port to the panel, or join again with --advertise.`,
          done: false,
        };
      }
      if (!node.approved) {
        return {
          step: "pending",
          label: `${node.name} registered and is waiting for approval.`,
          detail: reachedNow ? "The panel can reach it." : "The panel calls it back on its first heartbeat.",
          done: false,
        };
      }
      if (reachedNow) {
        return { step: "online", label: `${node.name} is in service.`, detail: "Approved, and the panel reaches it on its address.", done: true };
      }
      return {
        step: "approved",
        label: `${node.name} is approved.`,
        detail: reached === null ? "Waiting for the panel's first call to reach it." : "Waiting for the panel to reach it again.",
        done: false,
      };
    }
  }
}

/** The order the steps are drawn in, and how far along a step is. */
export const LIFECYCLE_STEPS: Array<{ step: LifecycleStep; title: string }> = [
  { step: "waiting", title: "Command run on the machine" },
  { step: "pending", title: "Registered" },
  { step: "approved", title: "Approved" },
  { step: "online", title: "Reached by the panel" },
];

export function stepIndex(step: LifecycleStep): number {
  switch (step) {
    case "waiting":
      return 0;
    case "pending":
    case "unreachable":
      return 1;
    case "approved":
      return 2;
    case "online":
      return 3;
    default:
      return -1;
  }
}
