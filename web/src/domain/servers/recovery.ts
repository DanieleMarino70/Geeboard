import type { RestartPolicy, ServerState } from "@prisma/client";

/* Bringing a crashed server back, and knowing when to stop trying.

   Docker could do this itself with a restart policy, and deliberately
   does not: a container restarting behind the panel's back is exactly
   the drift reconciliation exists to catch, and restart-after-crash is
   a decision that should be auditable. So the panel decides, and every
   attempt lands in the activity log with its reason.

   The hard part is not restarting. It is not restarting forever. A
   server that crashes on boot will crash on boot again, and a naive
   policy turns one broken world into a machine spending all night
   starting and killing the same process. Three things prevent that:
   a ceiling on attempts, a delay that grows between them, and a reset
   that only happens once the server has actually stayed up. */

export type RecoveryAction = "restart" | "wait" | "give-up" | "ignore";

export interface RecoveryDecision {
  action: RecoveryAction;
  /** Written for the activity log, and for a person reading it later. */
  reason: string;
  /** Which attempt this would be. 1 for the first. */
  attempt: number;
  /** For "wait": how much longer, in milliseconds. */
  waitMs?: number;
}

export interface RecoveryInput {
  state: ServerState;
  policy: RestartPolicy;
  /** How many restarts have been tried since the server was last well. */
  attempts: number;
  /** Ceiling on attempts. Ignored when the policy has no limit. */
  maxRestarts: number;
  /** When the last restart was attempted, for the backoff. */
  lastRestartAt: Date | null;
  /** The exit code the runtime reported, where it had one. */
  exitCode: number | null;
  /** Killed for using more memory than it was given. */
  oomKilled: boolean;
  now?: Date;
}

/* Growing delays between attempts.

   The first restart is immediate, because the overwhelmingly common
   case is a one-off — a bad tick, a plugin that threw, an upstream
   hiccup — and making somebody wait thirty seconds for that would be
   worse service for no safety. After that the gaps widen, because a
   second crash means the first restart did not fix anything. */
const BACKOFF_MS = [0, 30_000, 120_000, 300_000];

export function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)]!;
}

/* How long a server has to stay up before its attempt count is
   forgiven.

   Without this, a server that crashes once a week would eventually
   exhaust its budget and stay down — the count has to mean "crashing
   *now*", not "has ever crashed".

   The floor is ten minutes, but a game that takes longer than that to
   boot needs longer than that to count as stable. Rust generates its
   map for twenty; forgiving its attempts at ten would reset the budget
   while the server was still starting, which defeats the whole guard —
   a crash loop that never runs out of attempts is not a guard at all. */
export const STABLE_AFTER_MS = 10 * 60_000;

/** The stable window for a game, never shorter than its boot takes. */
export function stableWindowFor(bootGraceSeconds = 0): number {
  return Math.max(STABLE_AFTER_MS, Math.round(bootGraceSeconds * 1000 * 1.5));
}

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const now = input.now ?? new Date();
  const attempt = input.attempts + 1;

  if (input.state !== "CRASHED") {
    return { action: "ignore", reason: "The server has not crashed.", attempt: input.attempts };
  }

  if (input.policy === "NEVER") {
    return {
      action: "ignore",
      reason: "Automatic restart is off for this server.",
      attempt: input.attempts,
    };
  }

  /* A clean exit that the panel did not ask for. `ON_FAILURE` is about
     things that fell over; a server whose process chose to exit zero
     did not fall over, and starting it again would fight whatever
     decided to stop it. */
  if (input.policy === "ON_FAILURE" && input.exitCode === 0 && !input.oomKilled) {
    return {
      action: "ignore",
      reason: "It exited cleanly, and this server only restarts after a failure.",
      attempt: input.attempts,
    };
  }

  /* Out of memory is the one cause where restarting is actively wrong.
     The server asked for more than it was given; starting it again
     produces the same kill, on a loop, until somebody raises the limit.
     Better to stop and say so. */
  if (input.oomKilled) {
    return {
      action: "give-up",
      reason:
        "It ran out of memory. Restarting would hit the same limit — raise the memory ceiling first.",
      attempt: input.attempts,
    };
  }

  if (input.attempts >= input.maxRestarts) {
    return {
      action: "give-up",
      reason: `It crashed ${input.attempts} times in a row without staying up. Something is wrong that restarting will not fix.`,
      attempt: input.attempts,
    };
  }

  const wait = backoffFor(input.attempts);
  const since = input.lastRestartAt ? now.getTime() - input.lastRestartAt.getTime() : Infinity;

  if (since < wait) {
    return {
      action: "wait",
      reason: `Waiting before restart ${attempt}.`,
      attempt,
      waitMs: wait - since,
    };
  }

  return {
    action: "restart",
    reason:
      attempt === 1
        ? "It crashed; restarting."
        : `It crashed again; restart ${attempt} of ${input.maxRestarts}.`,
    attempt,
  };
}

/* Has this server been up long enough to forget its crashes?

   Checked against the time it started, not the time of the last crash:
   what matters is that the *current* run has lasted, which is the only
   evidence that whatever was wrong has stopped happening. */
export function shouldForgiveAttempts(
  state: ServerState,
  startedAt: Date | null,
  attempts: number,
  bootGraceSeconds = 0,
  now = new Date(),
): boolean {
  if (attempts === 0) return false;
  if (state !== "RUNNING") return false;
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() >= stableWindowFor(bootGraceSeconds);
}

/** How a policy reads in the UI. */
export const RESTART_POLICY_LABELS: Record<RestartPolicy, string> = {
  NEVER: "Never restart",
  ON_FAILURE: "Restart after a crash",
  ALWAYS: "Restart whenever it stops",
};
