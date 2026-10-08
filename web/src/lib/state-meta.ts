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

/* What each state means, in a sentence a person can act on: what is happening, and where to look or what to press when it is not going to
   change by itself. Shown as the pill's tooltip wherever the pill is, and in full under the name on the server's page for the states that
   pass. A state that has a longer explanation of its own (an install's progress, an unhealthy server's reason) keeps it: this is the line
   under the word, not instead of what the page knows. */
export const STATE_SAYS: Record<DbServerState, string> = {
  CREATING: "The panel is making the server: claiming its ports and its folder on the node.",
  INSTALLING: "The node is downloading the game and setting it up. The server's page shows how far it has got.",
  STARTING: "The game is starting. It is Running once its console says it is ready, which takes a minute, and several for a big world.",
  RUNNING: "The game is up and answering.",
  UNHEALTHY: "The container is up, but the game is not answering what the panel asks it. The Console shows why; Restart is the first thing to try.",
  STOPPING: "The game is saving and exiting. Stop waits for it, up to a minute.",
  STOPPED: "Off, and its world is untouched. Start brings it back.",
  RESTARTING: "Stopping, and starting again.",
  UPDATING: "A new version is being installed. A backup was taken first, and Roll back on this page undoes it.",
  BACKING_UP: "A backup of this server is being made.",
  MIGRATING: "The server is being moved to another node, through the off-site bucket.",
  DELETING: "The server and its world are being removed from the node.",
  CRASHED: "The game exited by itself. The panel starts it again as its restart policy says; the Console has its last lines.",
  ERROR: "It could not start, or could not finish what it was doing. The Console and the Activity page say why; put that right and press Start.",
  SUSPENDED: "Held by the panel, and not running.",
};

/** The same, by the word the pill shows, for a pill that knows its label and not the state it came from. */
export const SAYS_BY_LABEL: Record<string, string> = {
  ...Object.fromEntries((Object.keys(STATE_SAYS) as DbServerState[]).map((state) => [STATE_META[state].label, STATE_SAYS[state]])),
  Unknown: "The panel cannot see this server's node, so it cannot say what the server is doing.",
};

/* What a server reads as when the panel cannot see its node. The poller skips a node it cannot reach, so the row keeps the last state it
   had: a green "Running" and the last player count on a machine that has been gone for an hour. "Unknown" is what is true. */
export const UNKNOWN_META = { tone: "muted" as Tone, label: "Unknown", pulse: false };

/** The states a press of Start, Stop or Restart puts a server in at once, before the node has answered. */
export const OPTIMISTIC_STATE = { start: "STARTING", stop: "STOPPING", restart: "RESTARTING" } as const;
export type OptimisticState = (typeof OPTIMISTIC_STATE)[keyof typeof OPTIMISTIC_STATE];
