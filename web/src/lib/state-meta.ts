import type { ServerState as DbServerState } from "@prisma/client";
import type { Tone } from "./ui-types";

/* How a server's state reads: its tone and its word. Here and not in queries.ts, which is server-only, because a client component has to
   say a state too: the pill that shows "Stopping" the moment Stop is pressed, before the node has answered. */

/* Every state a server can be in, and how it reads. Pulsing means the
   state is transitional — something is happening and the row is about
   to change on its own. */
export const STATE_META: Record<DbServerState, { tone: Tone; label: string; pulse: boolean }> = {
  CREATING: { tone: "info", label: "Creating", pulse: true },
  INSTALLING: { tone: "info", label: "Installing", pulse: true },
  STARTING: { tone: "warning", label: "Starting", pulse: true },
  RUNNING: { tone: "success", label: "Running", pulse: false },
  // The workload is up but the game is not answering, which is a
  // different thing from being down and reads as one.
  UNHEALTHY: { tone: "warning", label: "Unhealthy", pulse: false },
  STOPPING: { tone: "warning", label: "Stopping", pulse: true },
  STOPPED: { tone: "muted", label: "Stopped", pulse: false },
  RESTARTING: { tone: "warning", label: "Restarting", pulse: true },
  UPDATING: { tone: "info", label: "Updating", pulse: true },
  BACKING_UP: { tone: "info", label: "Backing up", pulse: true },
  MIGRATING: { tone: "info", label: "Moving", pulse: true },
  DELETING: { tone: "danger", label: "Deleting", pulse: true },
  CRASHED: { tone: "danger", label: "Crashed", pulse: false },
  ERROR: { tone: "danger", label: "Error", pulse: false },
  SUSPENDED: { tone: "muted", label: "Suspended", pulse: false },
};

/* What a server reads as when the panel cannot see its node. The poller skips a node it cannot reach, so the row keeps the last state it
   had: a green "Running" and the last player count on a machine that has been gone for an hour. "Unknown" is what is true. */
export const UNKNOWN_META = { tone: "muted" as Tone, label: "Unknown", pulse: false };

/** The states a press of Start, Stop or Restart puts a server in at once, before the node has answered. */
export const OPTIMISTIC_STATE = { start: "STARTING", stop: "STOPPING", restart: "RESTARTING" } as const;
export type OptimisticState = (typeof OPTIMISTIC_STATE)[keyof typeof OPTIMISTIC_STATE];
