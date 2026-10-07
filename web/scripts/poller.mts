import "./load-env.mts";
import process from "node:process";

/* The metrics and reconciliation loop, as its own process.

   Deliberately not a timer inside the Next app: that would run once per
   server instance, restart on every rebuild, and quietly stop mattering
   in production behind more than one replica. One process, one loop. */

const { pollOnce, pruneSamples, pruneSessions } = await import("../src/lib/poller");
const { runDueTasks, scheduleOrphans } = await import("../src/lib/scheduler");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { deliverPending, dispatchNotifications, recordUpdatesAvailable, sweepDeliveries } = await import("../src/lib/notify/ops");
const { db } = await import("../src/lib/db");
const { logger, newRequestId, withRequestId } = await import("../src/lib/log");

/* A database that is not at this release's schema is not one to poll: the
   first query that touches what changed fails, every pass, for ever. Said once,
   with the command, and the process exits so that whatever supervises it shows
   that it is not running — see lib/schema-check.ts. */
if (process.env.NODE_ENV === "production") {
  const { checkSchema, describeSchema } = await import("../src/lib/schema-check");
  const { PANEL_VERSION } = await import("../src/lib/version");
  const verdict = await checkSchema(db);
  if (verdict !== "unknown" && !verdict.ok) {
    const { line, fix } = describeSchema(verdict, PANEL_VERSION, process.env.GEEBOARD_IN_IMAGE === "1");
    logger.error(line);
    logger.error(`refusing to start. ${fix}`);
    process.exit(1);
  }
}

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
/* How stale the game catalog may get before this process asks upstream
   again. It used to be refreshed only when somebody ran games:sync by
   hand, so a panel left alone offered last month's versions forever. */
const CATALOG_SYNC_MS = Number(process.env.CATALOG_SYNC_INTERVAL_MS ?? 6 * 3600_000);
const PRUNE_EVERY = 240; // roughly hourly at the default interval
const ONCE = process.argv.includes("--once");

let stopping = false;
let passes = 0;
let syncing = false;
let delivering = false;

/* Every line this process writes says which pass it belongs to, and the
   calls a pass makes to a node carry the same id — so a backup that
   failed at 03:00 is one string to grep for across the panel, this
   process and the agent. See src/lib/log.ts. */
process.env.GEEBOARD_COMPONENT ??= "poller";

/* Refreshes the catalog when its oldest row is older than the interval.

   Started, not awaited: a sync asks Steam, GitHub and Mojang and can take
   a while, and servers must not go unwatched for it. Read from the rows
   rather than a timer in this process, so a restart does not resync and a
   sync somebody ran by hand counts. */
async function syncCatalogIfStale() {
  if (syncing || CATALOG_SYNC_MS <= 0) return;
  // A retired game is never synced again, so its row would read as stale forever.
  const oldest = await db.game.aggregate({ _min: { syncedAt: true }, where: { retiredAt: null } });
  const at = oldest._min.syncedAt;
  if (at && Date.now() - at.getTime() < CATALOG_SYNC_MS) return;

  syncing = true;
  const started = Date.now();
  /* Its own id, not the pass's: it outlives the pass that started it. */
  void withRequestId(newRequestId(), "poller", () =>
    syncCatalog()
      .then((report) => {
        logger.info("catalog synced", { games: report.games, versions: report.versions, ms: Date.now() - started });
        for (const error of report.providerErrors) {
          logger.warn("version provider failed", { game: error.game, provider: error.provider, detail: error.message });
        }
        // A catalog that moved is where "an update is available" comes from; said once per server and version.
        return recordUpdatesAvailable().then((n) => {
          if (n > 0) logger.info("updates available", { servers: n });
        });
      })
      .catch((error: unknown) => {
        logger.error("catalog sync failed", { detail: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        syncing = false;
      }),
  );
}

/* Sends what is queued. Started, not awaited, outside --once: it can wait on
   a slow receiver, and two of it at once would send a message twice. */
async function deliverQueued() {
  if (delivering) return;
  delivering = true;
  try {
    const sent = await deliverPending();
    if (sent.attempted > 0) {
      logger.info("notifications sent", { sent: sent.sent, retrying: sent.retrying || undefined, failed: sent.failed || undefined });
    }
  } catch (error) {
    logger.error("notifications could not be sent", { detail: error instanceof Error ? error.message : String(error) });
  } finally {
    delivering = false;
  }
}

async function pass() {
  const started = Date.now();
  try {
    const report = await pollOnce();
    passes++;

    logger.info("poll", {
      servers: report.serversChecked,
      nodes: report.nodesChecked,
      samples: report.samplesWritten,
      // Left out when nothing happened: a line about a quiet pass should be short.
      corrected: report.driftCorrected || undefined,
      held: report.held || undefined,
      unhealthy: report.unhealthy || undefined,
      restarted: report.recovered || undefined,
      gaveUp: report.gaveUp || undefined,
      workloadsMissing: report.workloadsMissing || undefined,
      interruptedCreates: report.interruptedCreates || undefined,
      nodesUnreachable: report.nodesUnreachable || undefined,
      ms: Date.now() - started,
    });
    for (const error of report.errors) logger.warn("poll problem", { detail: error });

    /* Scheduled tasks run in this process too, rather than as a fourth
       service or a timer inside Next — that would fire once per replica,
       which for a nightly backup means every instance archiving the same
       world at the same moment. */
    if (!ONCE) await syncCatalogIfStale();

    /* What the pass wrote to the audit log becomes messages: read after a
       cursor, queued, and sent beside the pass and not in it — a receiver
       that takes five seconds to answer must not hold the servers' watch. */
    try {
      const queued = await dispatchNotifications();
      if (queued.queued > 0 || queued.suppressed > 0) {
        logger.info("notifications queued", { messages: queued.messages, deliveries: queued.queued, keptBack: queued.suppressed || undefined });
      }
    } catch (error) {
      logger.error("notifications could not be queued", { detail: error instanceof Error ? error.message : String(error) });
    }
    if (ONCE) await deliverQueued();
    else void deliverQueued();

    const schedule = await runDueTasks();
    if (schedule.due > 0) {
      logger.info("scheduled tasks", {
        due: schedule.due,
        ran: schedule.ran,
        failed: schedule.failed || undefined,
        skippedAsTooLate: schedule.skipped || undefined,
      });
      for (const error of schedule.errors) logger.warn("task problem", { detail: error });
    }

    if (passes % PRUNE_EVERY === 0) {
      const pruned = await pruneSamples();
      if (pruned > 0) logger.info("pruned old samples", { samples: pruned });

      // Deliveries that were sent a week ago, or given up on a month ago, have said what they had to.
      const swept = await sweepDeliveries();
      if (swept > 0) logger.info("pruned old notification deliveries", { deliveries: swept });

      // The catalog sync does this when it finishes; the hour is for a server that changed version in between.
      const updates = await recordUpdatesAvailable();
      if (updates > 0) logger.info("updates available", { servers: updates });

      // Sessions that have expired are dead rows; see pruneSessions.
      const ended = await pruneSessions();
      if (ended > 0) logger.info("pruned expired sessions", { sessions: ended });

      /* A task with no next run never fires, silently — which is the
         worst way for a backup schedule to fail. */
      const fixed = await scheduleOrphans();
      if (fixed > 0) logger.warn("scheduled tasks that had no next run", { tasks: fixed });
    }
  } catch (error) {
    // A failed pass must never end the loop; the next one may succeed.
    logger.error("poll failed", { detail: error instanceof Error ? error.message : String(error) });
  }
}

/** One id per pass, carried by everything the pass does — the node calls included. */
const onePass = () => withRequestId(newRequestId(), "poller", pass);

async function loop() {
  while (!stopping) {
    await onePass();
    if (stopping) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info("stopping", { signal, note: "finishing the current pass" });
  });
}

if (ONCE) {
  await onePass();
} else {
  logger.info("poller started", { everyMs: INTERVAL_MS, catalogSyncMs: CATALOG_SYNC_MS });
  await loop();
}

await db.$disconnect();
process.exit(0);
