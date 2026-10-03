-- 0.7.0: network and disk in a server's samples, a history for nodes, and the placeholder that was never read.
--
-- A server's samples gain the bytes received and sent since the sample before (null before 0.7.0 and on the
-- first sample of a run) and the world's size as last measured. The server keeps the counters it last read and
-- which run they belonged to, since Docker starts them again with the container. Nodes get a sample table of
-- their own, written from the heartbeat. `tps` was written as the constant 20 and read by nothing: it goes.

ALTER TABLE "metric_samples" DROP COLUMN "tps",
ADD COLUMN "rxBytes" BIGINT,
ADD COLUMN "txBytes" BIGINT,
ADD COLUMN "diskBytes" BIGINT;

ALTER TABLE "servers" ADD COLUMN "netRx" BIGINT,
ADD COLUMN "netTx" BIGINT,
ADD COLUMN "netStartedAt" TIMESTAMP(3);

CREATE TABLE "node_samples" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuPct" INTEGER NOT NULL,
    "ramPct" INTEGER NOT NULL,
    "diskPct" INTEGER NOT NULL,
    "pingMs" INTEGER NOT NULL,

    CONSTRAINT "node_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "node_samples_nodeId_at_idx" ON "node_samples"("nodeId", "at");

ALTER TABLE "node_samples" ADD CONSTRAINT "node_samples_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
