import type { ServerState } from "@prisma/client";

/* Who holds a server, and what becomes of it when whoever does stops.

   An update, a backup, a restore, a settings rebuild or a move is minutes of calls to a node, and for those minutes the server is
   in a state the platform owns: the poller will not look at it and the controls refuse it. It was given back only by the
   operation reaching its last line. An operation that was cut off (the panel restarted under it, the poller was killed mid-backup,
   a call that never came back) left the server "Updating" for ever, unwatched, and for one window with no way out in the page.

   So the operation claims the server before it begins, by one compare-and-set (lib/operations.ts), which is what refuses a second one
   that starts at the same moment; says every thirty seconds that it is alive; and when it is not, whoever finds out gives the server
   back with a sentence. This file is the arithmetic and the words. Pure, so it is tested without a database. */

export const OPERATIONS = ["backup", "restore", "update", "rollback", "rebuild", "settings", "move"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** The state each operation puts the server in while it runs. */
export const OPERATION_STATE: Record<Operation, ServerState> = {
  backup: "BACKING_UP",
  restore: "UPDATING",
  update: "UPDATING",
  rollback: "UPDATING",
  rebuild: "UPDATING",
  settings: "UPDATING",
  move: "MIGRATING",
};

/* The states an operation may begin from: a server that is settled. ERROR is in it, because a rebuild or a restore is how a server
   comes back from one. Not CREATING, INSTALLING, STARTING, STOPPING or DELETING, which are other operations' moments, nor SUSPENDED,
   which is an operator's decision. */
export const OPERABLE: readonly ServerState[] = ["RUNNING", "UNHEALTHY", "STOPPED", "CRASHED", "ERROR"];

/** The states that mean "an operation holds this server". */
export const HELD_BY_OPERATION: readonly ServerState[] = ["BACKING_UP", "UPDATING", "MIGRATING"];

/** How often a process that holds a server says so, and how long without that is silence: ten beats. */
export const BEAT_MS = 30_000;
export const STALE_MS_DEFAULT = 5 * 60_000;

const NAME: Record<Operation, string> = {
  backup: "a backup",
  restore: "a restore",
  update: "an update",
  rollback: "a rollback",
  rebuild: "a rebuild",
  settings: "a settings rebuild",
  move: "a move",
};

const STATE_WORD: Partial<Record<ServerState, string>> = {
  CREATING: "being created",
  INSTALLING: "installing",
  STARTING: "starting",
  STOPPING: "stopping",
  RESTARTING: "restarting",
  DELETING: "being deleted",
  SUSPENDED: "suspended",
};

export function isOperation(value: unknown): value is Operation {
  return typeof value === "string" && (OPERATIONS as readonly string[]).includes(value);
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export interface Held {
  state: ServerState;
  operation: string | null;
  operationStartedAt: Date | null;
}

/** Why a server cannot be claimed, in one sentence that begins with what to call it. */
export function busyReason(server: Held, now: number): string {
  if (HELD_BY_OPERATION.includes(server.state) && isOperation(server.operation)) {
    const since = server.operationStartedAt ? ` for ${duration(now - server.operationStartedAt.getTime())}` : "";
    return `Busy: ${NAME[server.operation]} has been running${since}.`;
  }
  if (HELD_BY_OPERATION.includes(server.state)) {
    return `Busy: ${server.state === "BACKING_UP" ? "a backup" : server.state === "MIGRATING" ? "a move" : "an update"} is running.`;
  }
  const word = STATE_WORD[server.state];
  if (word) return `Busy: it is ${word}.`;
  return `Not now: it is ${server.state.toLowerCase()}.`;
}

/* Whether a lifecycle action may begin from where the server is, and if not why, in a sentence. The guards in state.ts (canStart, canStop,
   canDelete) existed and nothing called them: a delete could begin under an update, a restart under a backup, and the nightly restart
   task landed in the middle of the nightly backup. What is refused is the states that are another operation's moment. A server that is
   being created or installed can still be deleted, because that is how a creation that went wrong is got rid of. */
export function refusalFor(action: "start" | "stop" | "restart" | "delete", server: Held, now: number): string | null {
  const another = HELD_BY_OPERATION.includes(server.state);
  const busy = busyReason(server, now);
  switch (action) {
    case "start":
      return another || ["CREATING", "INSTALLING", "DELETING", "STOPPING", "RESTARTING"].includes(server.state) ? busy : null;
    case "stop":
    case "restart":
      return another || ["CREATING", "INSTALLING", "DELETING"].includes(server.state) ? busy : null;
    case "delete":
      return another || server.state === "DELETING" ? busy : null;
  }
}

export interface Interruption {
  /** What the server becomes. */
  state: ServerState;
  lastError: string | null;
  /** What was found, for the audit line and the log. */
  sentence: string;
}

export type InterruptionCause = { kind: "restarted"; process: "panel" | "poller" } | { kind: "silent"; ms: number };

function why(cause: InterruptionCause): string {
  return cause.kind === "restarted"
    ? `${cause.process === "poller" ? "The watchdog" : "The panel"} was stopped while it ran`
    : `nothing has said it is alive for ${duration(cause.ms)}`;
}

/* What becomes of a server whose operation was cut short.

   A backup that did not finish has changed nothing about the server, so the server goes back to what it was; the backup's own row is
   marked failed by the caller. Every other operation changes the server, and a half-done one is not a state to pretend is fine: it is
   ERROR with a sentence, which is also the state the page offers a rebuild for. */
export function interruption(operation: string | null, stateBefore: ServerState | null, cause: InterruptionCause): Interruption {
  const name = isOperation(operation) ? NAME[operation] : "an operation";
  const reason = why(cause);
  if (operation === "backup") {
    const back = stateBefore && !HELD_BY_OPERATION.includes(stateBefore) ? stateBefore : "STOPPED";
    return {
      state: back,
      lastError: null,
      sentence: `${name[0]!.toUpperCase()}${name.slice(1)} did not finish: ${reason}. The server was not changed and is ${back.toLowerCase()} again; the backup is marked failed.`,
    };
  }
  const tail =
    operation === "move"
      ? "The world is still on its old node unless the move got as far as the new one: look at the server's page, then start it there, or move it again."
      : "Its files are as the last step left them: rebuild it to bring it back, or restore a backup.";
  const sentence = `${name[0]!.toUpperCase()}${name.slice(1)} did not finish: ${reason}. ${tail}`;
  return { state: "ERROR", lastError: sentence, sentence };
}

/** Whether a held server has been silent for longer than the allowance. A server with no beat at all is judged by when it was last touched. */
export function isSilent(beat: Date | null, touched: Date, now: number, staleMs: number): boolean {
  return now - (beat ?? touched).getTime() > staleMs;
}
