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

/* A server that stopped and was not crashed, and was not stopped by the panel.

   The commonest cause is the machine: a reboot, or Docker restarting, stops
   every container on it with SIGTERM, and the agent reads that as an ordinary
   stop on purpose (daemon/src/docker.ts: a game under a shell that never handles
   SIGTERM is killed by the grace period, and that is not a crash). So after a
   reboot every server was "stopped" and none came back, with a restart policy
   that said "restart whenever it stops".

   What the panel did not ask for is told from what it did by the state it had
   written before it looked: a stop, a restart and every operation set theirs
   first, so a server that goes from running to stopped with none of them is
   somebody else's doing: the machine, somebody's `docker stop`, a command in the
   game, or the game's own exit.

   What caused it is a separate question and often has no answer. Measured on a
   real machine: a Minecraft server asked to stop by Docker's SIGTERM exits with
   code 0, the same code as the game quitting by itself, so the exit code names the
   machine only for the games that die of the signal. The panel says what it has
   evidence for and no more. */
export type StopEvidence = "signal" | "together" | "none";

/** Exit codes a signal leaves: 143 (SIGTERM), 137 (SIGKILL after the grace period), 130 (SIGINT). */
export function endedBySignal(exitCode: number | null): boolean {
  return exitCode === 143 || exitCode === 137 || exitCode === 130;
}

/* What there is to say about why one server stopped. Its own exit code, if a signal ended it; else that it was not
   alone: a machine or Docker restarting stops everything on the node in the same pass, and one game quitting does
   not. `stoppedOnNode` counts every server on that node the panel found stopped without having asked, in the pass. */
export function stopEvidence(exitCode: number | null, stoppedOnNode: number): StopEvidence {
  if (endedBySignal(exitCode)) return "signal";
  return stoppedOnNode >= 2 ? "together" : "none";
}

/** What a server's page says while the panel is waiting its turn to start it again, and what tells the next pass to. */
export const STOP_PENDING = "Stopped without the panel asking";

export interface LeftStoppedInput {
  policy: RestartPolicy;
  evidence: StopEvidence;
  /** The node's name, for "together". */
  node: string;
  /** How many other servers stopped with it. */
  others: number;
  /** What the game said when it stopped, if its definition knows that failure: better than any guess. */
  known?: string | null;
}

/* The sentence a server's page and the message carry: why it is down, why nothing started it, and what to do. */
export function leftStoppedReason(input: LeftStoppedInput): string {
  const policy = `Its restart policy is "${RESTART_POLICY_LABELS[input.policy]}", which does not start it again, so it was left stopped. Start it from this page.`;
  if (input.known) return `${input.known} ${policy}`;
  const why =
    input.evidence === "signal"
      ? "Docker or the machine stopped it: the game was ended by a signal, which is what a restart of either does."
      : input.evidence === "together"
        ? `It stopped together with ${input.others} other server${input.others === 1 ? "" : "s"} on ${input.node}, which points at the machine or Docker restarting.`
        : "The panel did not stop it and nothing says why: the game may have quit by itself or been stopped from inside it or on the node, or the machine or Docker may have restarted.";
  return `${why} ${policy}`;
}

export interface StopRecoveryInput {
  policy: RestartPolicy;
  attempts: number;
  maxRestarts: number;
  lastRestartAt: Date | null;
  evidence: StopEvidence;
  now?: Date;
}

/* What to do about a server that stopped without being asked.

   ALWAYS is "restart whenever it stops", and means it. With nothing to say why, it
   has the same ceiling and the same growing delays as a crash, because a game that
   stops the moment it starts is no better for having exited 0. With evidence that
   the machine did it (a signal, or the node's other servers stopping with it) there
   is no loop to guard against: it is started at once, and does not use up the
   budget a real crash loop needs, or two reboots in an afternoon, a kernel update
   and the fix for it, would leave the server in ERROR. ON_FAILURE and NEVER leave
   it stopped, and the poller says so (leftStoppedReason) once it knows how many
   stopped with it. */
export function decideAfterStop(input: StopRecoveryInput): RecoveryDecision {
  const now = input.now ?? new Date();
  const attempt = input.attempts + 1;

  if (input.policy !== "ALWAYS") {
    return {
      action: "ignore",
      reason: leftStoppedReason({ policy: input.policy, evidence: input.evidence, node: "its node", others: 0 }),
      attempt: input.attempts,
    };
  }

  if (input.evidence !== "none") {
    return {
      action: "restart",
      reason:
        input.evidence === "signal"
          ? "Docker or the machine stopped it; its policy is to restart whenever it stops, so the panel started it."
          : "It stopped together with the other servers of its node, which points at the machine or Docker restarting; its policy is to restart whenever it stops, so the panel started it.",
      attempt: input.attempts,
    };
  }

  if (input.attempts >= input.maxRestarts) {
    return {
      action: "give-up",
      reason: `It stopped ${input.attempts} times in a row without staying up. Something is wrong that restarting will not fix.`,
      attempt: input.attempts,
    };
  }

  const wait = backoffFor(input.attempts);
  const since = input.lastRestartAt ? now.getTime() - input.lastRestartAt.getTime() : Infinity;
  if (since < wait) {
    return { action: "wait", reason: `Waiting before restart ${attempt}.`, attempt, waitMs: wait - since };
  }

  return {
    action: "restart",
    reason:
      attempt === 1
        ? "It stopped and the panel did not ask it to; its policy is to restart whenever it stops, so the panel started it."
        : `It stopped and the panel did not ask it to, again; restart ${attempt} of ${input.maxRestarts}.`,
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
