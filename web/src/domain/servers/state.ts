import type { ServerState } from "@prisma/client";
import type { RuntimeState } from "../runtime/types";

/* A game server's state, as the platform means it.

   The runtime has an opinion — running, stopped, crashed — and it is a
   narrow one. It cannot tell installing from starting, because both look
   like a container that has not settled; it cannot tell a server being
   backed up from one somebody stopped; and a container that is up says
   nothing about whether the game inside it is answering.

   So the runtime's view is one input to this, not the whole of it. */

export const PLATFORM_OWNED: ReadonlySet<ServerState> = new Set<ServerState>([
  // The platform is mid-operation and knows more than the runtime does.
  "CREATING",
  "INSTALLING",
  "UPDATING",
  "BACKING_UP",
  "DELETING",
  // An operator took it out of service; a stopped container is the point.
  "SUSPENDED",
]);

export const TRANSITIONAL: ReadonlySet<ServerState> = new Set<ServerState>([
  "CREATING",
  "INSTALLING",
  "STARTING",
  "STOPPING",
  "UPDATING",
  "BACKING_UP",
  "DELETING",
]);

/** States in which the server is meant to be serving players. */
export const LIVE: ReadonlySet<ServerState> = new Set<ServerState>(["RUNNING", "UNHEALTHY"]);

/** The runtime's vocabulary, read as a server state. */
export function mapRuntimeState(state: RuntimeState): ServerState {
  switch (state) {
    case "running":
      return "RUNNING";
    case "starting":
      return "STARTING";
    case "stopping":
      return "STOPPING";
    case "crashed":
      return "CRASHED";
    case "stopped":
      return "STOPPED";
    /* The runtime could not say. Treating that as stopped would show a
       running server as down; it is the panel's own record that is
       least likely to be wrong here, so nothing changes. */
    case "unknown":
      return "STOPPED";
  }
}

export interface Reconciliation {
  /** What the server's state should now be recorded as. */
  state: ServerState;
  /** True when the observation was ignored in favour of what we know. */
  held: boolean;
  /** Worth an activity event, and what to call it. */
  event: { action: string; tone: "DANGER" | "WARNING" | "INFO" } | null;
}

/* Reconciles what the panel believes against what the node reports.

   Two things stop this from being a straight assignment. A platform-owned
   state outranks the observation — a server being installed is not
   "stopped" just because its container has not been made yet, and
   overwriting that would make a long install look like a failure. And a
   change nobody asked for is news: a crash at 3am, or a container an
   operator stopped by hand on the node, is exactly what reconciliation
   exists to surface. */
export function reconcile(current: ServerState, observed: ServerState): Reconciliation {
  if (PLATFORM_OWNED.has(current)) {
    return { state: current, held: true, event: null };
  }

  if (current === observed) return { state: observed, held: false, event: null };

  // Unhealthy is a judgement about the game, not the workload. A running
  // container does not clear it; only a health check does.
  if (current === "UNHEALTHY" && observed === "RUNNING") {
    return { state: "UNHEALTHY", held: true, event: null };
  }

  return { state: observed, held: false, event: driftEvent(current, observed) };
}

function driftEvent(from: ServerState, to: ServerState): Reconciliation["event"] {
  // The server died without anyone asking it to.
  if (to === "CRASHED") return { action: "server.crashed", tone: "DANGER" };

  // It went down while the panel believed it was up.
  if (to === "STOPPED" && (from === "RUNNING" || from === "STARTING" || from === "UNHEALTHY")) {
    return { action: "server.stopped.unexpectedly", tone: "WARNING" };
  }

  // It came back without the panel doing it — usually a restart policy.
  if (to === "RUNNING" && (from === "STOPPED" || from === "CRASHED" || from === "ERROR")) {
    return { action: "server.recovered", tone: "INFO" };
  }

  /* STARTING → RUNNING and STOPPING → STOPPED are the transitions the
     panel already asked for. They are not news. */
  return null;
}

/** Whether a lifecycle action makes sense from where the server is now. */
export function canStart(state: ServerState): boolean {
  return state === "STOPPED" || state === "CRASHED" || state === "ERROR" || state === "SUSPENDED";
}

export function canStop(state: ServerState): boolean {
  return state === "RUNNING" || state === "STARTING" || state === "UNHEALTHY";
}

export function canDelete(state: ServerState): boolean {
  return !TRANSITIONAL.has(state);
}
