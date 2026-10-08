import "./load-env.mts";
import process from "node:process";

/* Before anything is imported: the id this process claims servers under (lib/operations.ts) and the component its log lines carry are made
   from it when their modules load. */
process.env.GEEBOARD_COMPONENT ??= "poller";

/* The metrics and reconciliation loop, as its own process.

   Deliberately not a timer inside the Next app: that would run once per
   server instance, restart on every rebuild, and quietly stop mattering
   in production behind more than one replica. One process, one loop. */

const { pollOnce, pruneSamples, pruneSessions, settleBackground } = await import("../src/lib/poller");
const { runDueTasks, scheduleOrphans } = await import("../src/lib/scheduler");
const { catalogGaps, syncCatalog } = await import("../src/lib/catalog-sync");
const { deliverPending, dispatchNotifications, recordUpdatesAvailable, sweepDeliveries } = await import("../src/lib/notify/ops");
const { checkForUpdates, recordPanelUpdateNews } = await import("../src/lib/panel-update-ops");
const { db } = await import("../src/lib/db");
const { logger, newRequestId, withRequestId } = await import("../src/lib/log");
const { acquirePollerLock, PollerLockHeld } = await import("../src/lib/poller-lock");
const { lastPruneAt, markPassBegan, markPassFinished, markPruned, markStarted } = await import("../src/lib/watchdog");
const { reapInterrupted } = await import("../src/lib/operations");
const { checkSealedSecrets } = await import("../src/lib/sealed-check");
const { describeSealed } = await import("../src/domain/sealed");
const { SECRETS_KEY_SENTENCE } = await import("../src/domain/errors");

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

/* One poller per database, and this is what makes it so: a lock on a connection of its own (lib/poller-lock.ts). A second poller says why
   in one line and leaves with 75 (EX_TEMPFAIL); one whose connection to the database goes takes itself away, so that its supervisor starts it
   again and it takes the lock again. */
let lock: Awaited<ReturnType<typeof acquirePollerLock>>;
try {
  lock = await acquirePollerLock(process.env.DATABASE_URL!, (why) => {
    logger.error(`${why}, so this poller is leaving: it cannot know whether another has started in the meantime`);
    process.exit(1);
  });
} catch (error) {
  if (error instanceof PollerLockHeld) {
    logger.error(error.message);
    process.exit(75);
  }
  logger.error("the poller could not reach the database to take its lock", { detail: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
/* How stale the game catalog may get before this process asks upstream
   again. It used to be refreshed only when somebody ran games:sync by
   hand, so a panel left alone offered last month's versions forever. */
const CATALOG_SYNC_MS = Number(process.env.CATALOG_SYNC_INTERVAL_MS ?? 6 * 3600_000);
/* Old rows are pruned from the clock, once an hour, and the time of the last one is kept in the watchdog's row. It used to be every 240th
   pass counted from the process's start, so a poller restarted more often than hourly never pruned, and the rows it keeps grew for ever. */
const PRUNE_MS = 3_600_000;
const ONCE = process.argv.includes("--once");
/* Scheduled tasks being run at once, over all servers, and never two on one node (lib/scheduler.ts). A backup is a disk and a network: two at a
   time is what a small node can carry and what a bucket's uplink is shared by. */
const TASK_CONCURRENCY = Math.max(1, Number(process.env.TASK_CONCURRENCY) || 2);

let stopping = false;
let lastPrune = ONCE ? Date.now() : 0;
let warnedState = false;
let syncing = false;
let delivering = false;
let tasking: Promise<void> | null = null;
/* The nodes whose token was last said to be unreadable, so that it is said once and said again when it changes. */
let saidUnreadable = "";

/* Every line this process writes says which pass it belongs to, and the
   calls a pass makes to a node carry the same id — so a backup that
   failed at 03:00 is one string to grep for across the panel, this
   process and the agent. See src/lib/log.ts. */

/* Refreshes the catalog when its oldest row is older than the interval.

   Started, not awaited: a sync asks Steam, GitHub and Mojang and can take
   a while, and servers must not go unwatched for it. Read from the rows
   rather than a timer in this process, so a restart does not resync and a
   sync somebody ran by hand counts. */
async function syncCatalogIfStale() {
  if (syncing) return;
  /* Whatever the age: a game or a version the definitions ship that has no row is the state a panel is in after a release that adds one,
     and a server made in it has no game to be stopped, saved and judged by. Offline, from the definitions, and quick, so awaited. */
  const gaps = await catalogGaps();
  if (gaps > 0) {
    await syncCatalog({ offline: true })
      .then(() => logger.info("catalog rows the definitions ship were missing, and were added", { gaps }))
      .catch((error: unknown) => logger.error("catalog sync of missing rows failed", { detail: error instanceof Error ? error.message : String(error) }));
  }
  if (CATALOG_SYNC_MS <= 0) return;
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

/* Runs what is due, started and not awaited: a backup is minutes, and the watch does not stop for it (lib/scheduler.ts). One run at a time;
   what falls due while it goes is picked up by the run itself, in its turn. A --once pass runs them where it stands, and waits. */
function startTasks(): Promise<void> | null {
  if (tasking) return tasking;
  const began = Date.now();
  // Its own id, not the pass's: it outlives the pass that started it.
  const running: Promise<void> = withRequestId(newRequestId(), "poller", () =>
    runDueTasks(new Date(), { shouldStop: () => stopping, concurrency: ONCE ? 1 : TASK_CONCURRENCY })
      .then((schedule) => {
        if (schedule.due > 0) {
          logger.info("scheduled tasks", {
            due: schedule.due,
            ran: schedule.ran,
            failed: schedule.failed || undefined,
            skippedAsTooLate: schedule.skipped || undefined,
            ms: Date.now() - began,
          });
          for (const error of schedule.errors) logger.warn("task problem", { detail: error });
        }
      })
      .catch((error: unknown) => {
        logger.error("scheduled tasks could not be run", { detail: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        tasking = null;
      }),
  );
  tasking = running;
  return running;
}

/* A node's token that SECRETS_KEY does not open is said once, with the names, and again when the set changes: the line in each pass that it
   used to be was OpenSSL's words and no node. */
function sayUnreadable(nodes: string[]) {
  const key = [...nodes].sort().join(", ");
  if (key === saidUnreadable) return;
  if (key) {
    logger.error("a node's token cannot be opened, so the panel cannot reach it", {
      nodes: key,
      detail: SECRETS_KEY_SENTENCE,
      fix: "put the previous SECRETS_KEY back in deploy/panel/.env and restart; if the key was being changed, finish with rekey (docs/security.md)",
    });
  } else {
    logger.info("every node's token opens again");
  }
  saidUnreadable = key;
}

/* The watchdog's row is a courtesy to whoever looks: a failure to write it is said once and never ends a pass. */
async function remember(write: () => Promise<void>) {
  if (ONCE) return;
  try {
    await write();
  } catch (error) {
    if (!warnedState) {
      warnedState = true;
      logger.warn("the watchdog's own row could not be written; the pages will say it has not reported", { detail: error instanceof Error ? error.message : String(error) });
    }
  }
}

/* Servers whose operation was cut short are given back, every pass: one whose process is gone has not beaten for five minutes. See lib/operations.ts. */
async function giveBackInterrupted() {
  try {
    for (const one of await reapInterrupted()) {
      logger.warn("a server was given back", { server: one.slug, now: one.state, detail: one.sentence });
    }
  } catch (error) {
    logger.warn("could not look for operations that were cut short", { detail: error instanceof Error ? error.message : String(error) });
  }
}

async function pass() {
  const started = Date.now();
  await remember(markPassBegan);
  if (!ONCE) await giveBackInterrupted();
  try {
    const report = await pollOnce();

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
      unreadable: report.nodesUnreadable.length || undefined,
      skippedNodes: report.nodesSkipped.length || undefined,
      // The pass is as long as its slowest node: said, so that a long one can be put on a name.
      slowest: report.slowestNode ? `${report.slowestNode.name} ${report.slowestNode.ms} ms` : undefined,
      dnsSynced: report.dnsSynced || undefined,
      dnsFailed: report.dnsFailed || undefined,
      dnsDeferred: report.dnsDeferred || undefined,
      ms: Date.now() - started,
    });
    for (const error of report.errors) logger.warn("poll problem", { detail: error });
    sayUnreadable(report.nodesUnreadable);

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

    /* Scheduled tasks run in this process too, rather than as a fourth service or a timer inside Next — that would fire once per replica,
       which for a nightly backup means every instance archiving the same world at the same moment. Beside the pass, as deliveries are:
       a night of backups no longer stops the watch. */
    if (ONCE) await startTasks();
    else void startTasks();
    if (ONCE) await settleBackground();

    if (Date.now() - lastPrune >= PRUNE_MS) {
      lastPrune = Date.now();
      await remember(markPruned);
      const pruned = await pruneSamples();
      if (pruned > 0) logger.info("pruned old samples", { samples: pruned });

      // Deliveries that were sent a week ago, or given up on a month ago, have said what they had to.
      const swept = await sweepDeliveries();
      if (swept > 0) logger.info("pruned old notification deliveries", { deliveries: swept });

      // The catalog sync does this when it finishes; the hour is for a server that changed version in between.
      const updates = await recordUpdatesAvailable();
      if (updates > 0) logger.info("updates available", { servers: updates });

      /* Whether a newer Geeboard is out: a request for one small file at most every twelve hours (nothing at all with
         GEEBOARD_UPDATE_CHECK=off), and an audit line once for what it finds. Never a reason for a pass to fail. */
      try {
        const looked = await checkForUpdates();
        if (looked.ran) {
          if (looked.ok) logger.info("update check", { latest: looked.latest, newRelease: looked.changed || undefined });
          else logger.warn("update check could not read the release file", { detail: looked.error });
        }
        if (await recordPanelUpdateNews()) logger.info("a newer release is out, and the panel has said so");
      } catch (error) {
        logger.warn("update check failed", { detail: error instanceof Error ? error.message : String(error) });
      }

      // Sessions that have expired are dead rows; see pruneSessions.
      const ended = await pruneSessions();
      if (ended > 0) logger.info("pruned expired sessions", { sessions: ended });

      /* A task with no next run never fires, silently — which is the
         worst way for a backup schedule to fail. */
      const fixed = await scheduleOrphans();
      if (fixed > 0) logger.warn("scheduled tasks that had no next run", { tasks: fixed });
    }

    // Last, after the scheduled tasks and the prune: "last pass" is when the watchdog was last free to look, and a pass that threw is not recorded.
    await remember(() => markPassFinished({ servers: report.serversChecked, nodes: report.nodesChecked, errors: report.errors.length, ms: Date.now() - started }));
  } catch (error) {
    // A failed pass must never end the loop; the next one may succeed.
    logger.error("poll failed", { detail: error instanceof Error ? error.message : String(error) });
  }
}

/** One id per pass, carried by everything the pass does — the node calls included. */
const onePass = () => withRequestId(newRequestId(), "poller", pass);

/* The wait between passes ends the moment a signal asks the poller to stop: an idle poller used to sleep out the rest of its interval, and
   Docker's SIGKILL came first when more than the grace period was left of it. */
let wake: (() => void) | null = null;
const sleepUnlessStopping = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });

async function loop() {
  while (!stopping) {
    await onePass();
    if (stopping) break;
    await sleepUnlessStopping(INTERVAL_MS);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    logger.info("stopping", { signal, note: "finishing the current pass" });
    wake?.();
  });
}

if (ONCE) {
  await onePass();
} else {
  logger.info("poller started", { everyMs: INTERVAL_MS, catalogSyncMs: CATALOG_SYNC_MS, pruneEveryMs: PRUNE_MS });
  /* Whatever a poller of this kind left behind when it died is not being done by anybody: it holds the lock now, so the one before it is gone. */
  try {
    for (const one of await reapInterrupted({ afterStartOf: "poller" })) {
      logger.warn("a server was given back", { server: one.slug, now: one.state, detail: one.sentence });
    }
  } catch (error) {
    logger.warn("could not look for operations the last poller left", { detail: error instanceof Error ? error.message : String(error) });
  }
  /* Does the key this process has open what the database holds? Said at start, in one line: it used to be found out by the first page that
     opened a node's token, or a sign-in with two-factor, or a night's backups that did not happen. */
  try {
    const line = describeSealed(await checkSealedSecrets());
    if (line) logger.error(line, { fix: "put the previous SECRETS_KEY back in deploy/panel/.env and restart; if the key was being changed, finish with rekey (docs/security.md)" });
  } catch (error) {
    logger.warn("could not check that the stored secrets open", { detail: error instanceof Error ? error.message : String(error) });
  }
  await remember(async () => {
    await markStarted(INTERVAL_MS);
    // A restart is not a reason to prune again at once.
    lastPrune = (await lastPruneAt())?.getTime() ?? 0;
  });
  await loop();
  // A backup that began is finished, and gets the grace the container was given; a second signal does not wait.
  if (tasking) {
    logger.info("waiting for the scheduled tasks that began");
    await tasking;
  }
}

await lock.release();
await db.$disconnect();
process.exit(0);
