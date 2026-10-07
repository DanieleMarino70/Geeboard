import "server-only";
import { judgeWatchdog, type WatchdogView } from "@/domain/watchdog";
import { db } from "./db";
import { PANEL_VERSION } from "./version";

/* The watchdog's row (poller_state), written by the poller and read by the pages. The domain file says what it means. */

const ROW = 1;

/** The poller says it has started. */
export async function markStarted(intervalMs: number): Promise<void> {
  const now = new Date();
  await db.pollerState.upsert({
    where: { id: ROW },
    create: { id: ROW, startedAt: now, version: PANEL_VERSION, intervalMs },
    update: { startedAt: now, version: PANEL_VERSION, intervalMs, lastPassAt: null, passStartedAt: null },
  });
}

/** A pass begins: until it ends, "late" is judged knowing that one is running. */
export async function markPassBegan(): Promise<void> {
  await db.pollerState.updateMany({ where: { id: ROW }, data: { passStartedAt: new Date() } });
}

export interface PassFigures {
  servers: number;
  nodes: number;
  errors: number;
  ms: number;
}

/** A pass that finished. A pass that threw is not recorded: the row's age is how that shows. */
export async function markPassFinished(figures: PassFigures): Promise<void> {
  await db.pollerState.updateMany({
    where: { id: ROW },
    data: { lastPassAt: new Date(), lastPassMs: figures.ms, servers: figures.servers, nodes: figures.nodes, errors: figures.errors },
  });
}

/** When the poller last pruned, or null: read at start, so that a restart is not a reason to prune again. */
export async function lastPruneAt(): Promise<Date | null> {
  const row = await db.pollerState.findUnique({ where: { id: ROW }, select: { lastPruneAt: true } });
  return row?.lastPruneAt ?? null;
}

/** The hourly prune ran. */
export async function markPruned(): Promise<void> {
  await db.pollerState.updateMany({ where: { id: ROW }, data: { lastPruneAt: new Date() } });
}

/* What the pages show. Null when it cannot tell: a database that has not had this release's migration yet (the panel is up and the
   migration is the next command), or a client generated before the model existed. A line that is missing is better than a page that
   is not there. */
export async function readWatchdog(): Promise<WatchdogView | null> {
  try {
    const row = await db.pollerState.findUnique({ where: { id: ROW } });
    return judgeWatchdog(row, Date.now(), PANEL_VERSION, process.env.GEEBOARD_IN_IMAGE === "1");
  } catch {
    return null;
  }
}
