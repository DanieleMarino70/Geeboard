-- 0.9.0: a watchdog that can be seen, and prunes that do not read whole tables.
--
-- poller_state is one row the poller writes: when it started, when each pass began and finished, how long the last one
-- took, how many servers and nodes it looked at, and the release it is. The panel's pages read it to say how long ago
-- the watchdog last passed, and the poller container's healthcheck reads it to say unhealthy when it has not for three
-- intervals.
--
-- The two sample tables get an index on "at" alone: the hourly prune deletes by age and the index they had starts
-- with the server (or node), so Postgres read the whole table, or the whole index, to find what was old.

CREATE TABLE "poller_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastPassAt" TIMESTAMP(3),
    "lastPassMs" INTEGER,
    "servers" INTEGER NOT NULL DEFAULT 0,
    "nodes" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "passStartedAt" TIMESTAMP(3),
    "version" TEXT NOT NULL,
    "intervalMs" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastPruneAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poller_state_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "metric_samples_at_idx" ON "metric_samples"("at");

CREATE INDEX "node_samples_at_idx" ON "node_samples"("at");
