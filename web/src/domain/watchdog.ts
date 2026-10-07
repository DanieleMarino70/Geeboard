import { timeAgo } from "@/lib/format";

/* What the watchdog reports about itself, and when that is a problem.

   The poller is the one process that looks at every server and every node, restarts what crashed, runs the scheduled tasks and sends
   the notifications; when it is dead or stuck, none of that happens and nothing says so, because the things it would have said are the
   things it does. It writes one row (poller_state) as it goes, and this reads the row: the dashboard and the Nodes page say how long
   ago it last passed, and warn when that is more than three of its own intervals, and the poller container's healthcheck
   (scripts/poller-health.mjs) judges by the same rule.

   Pure, so the arithmetic is tested without a database. */

/** How many intervals without a finished pass is late. A pass takes a second or two; three is a missed one and a half. */
export const LATE_AFTER_INTERVALS = 3;

export interface WatchdogRow {
  startedAt: Date;
  lastPassAt: Date | null;
  lastPassMs: number | null;
  passStartedAt: Date | null;
  intervalMs: number;
  version: string;
}

export type WatchdogState = "ok" | "late" | "waiting";

export interface WatchdogView {
  state: WatchdogState;
  /** One sentence for a page. */
  line: string;
  /** What to do about it, when it is late. */
  fix: string | null;
  /** The poller and the panel are different releases. */
  versionMismatch: boolean;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/* The compose file's name for the stack, spelled for where it is run: the commands that say whether the poller is up. */
export function watchdogFix(inImage: boolean): string {
  return inImage
    ? "docker compose -f deploy/panel/docker-compose.yml ps    then    docker compose -f deploy/panel/docker-compose.yml logs poller"
    : "npm run poll    (the poller runs as its own process, beside the panel)";
}

export function judgeWatchdog(row: WatchdogRow | null, now: number, panelVersion: string, inImage: boolean): WatchdogView {
  const waiting = (line: string): WatchdogView => ({ state: "waiting", line, fix: null, versionMismatch: false });
  if (!row) return waiting("Watchdog: no pass recorded yet. It reports a few seconds after the poller starts.");

  const late = row.intervalMs * LATE_AFTER_INTERVALS;
  const mismatch = row.version !== "unknown" && panelVersion !== "unknown" && row.version !== panelVersion;
  const mismatchSentence = mismatch ? ` The poller is ${row.version} and this panel is ${panelVersion}: bring both to one release.` : "";
  const view = (state: WatchdogState, line: string, fix: string | null): WatchdogView => ({
    state,
    line: line + mismatchSentence,
    fix,
    versionMismatch: mismatch,
  });

  const began = row.passStartedAt && (!row.lastPassAt || row.passStartedAt > row.lastPassAt) ? row.passStartedAt : null;

  if (!row.lastPassAt) {
    // Started, and has not finished a pass: a first pass on a big fleet takes a while, and a stuck one never ends.
    const since = now - row.startedAt.getTime();
    if (since <= late + 60_000) return view("waiting", "Watchdog: started, and has not finished its first pass yet.", null);
    return view(
      "late",
      `Watchdog: started ${duration(since)} ago and has not finished a pass. Servers are not being watched, nothing restarts and no backup runs.`,
      watchdogFix(inImage),
    );
  }

  const age = now - row.lastPassAt.getTime();
  if (age <= late) return view("ok", `Watchdog: last pass ${timeAgo(row.lastPassAt, now)}.`, null);

  if (began && now - began.getTime() > late) {
    /* Alive and slow. A node that does not answer is given forty-five seconds and no more, and scheduled tasks run beside the pass: a pass this
       long is the DNS provider or the database taking its time. The cause is different from a dead process, and the effect is not. */
    return view(
      "late",
      `Watchdog: a pass has been running for ${duration(now - began.getTime())}, much longer than it should, and the last one ended ${timeAgo(row.lastPassAt, now)}. Something in it is slow (a node, the DNS provider, the database); servers are not being watched until it ends.`,
      null,
    );
  }
  if (began) return view("ok", `Watchdog: a pass is running, and the last one ended ${timeAgo(row.lastPassAt, now)}.`, null);

  return view(
    "late",
    `Watchdog: last pass ${timeAgo(row.lastPassAt, now)}. Servers are not being watched, nothing restarts and no backup runs.`,
    watchdogFix(inImage),
  );
}
