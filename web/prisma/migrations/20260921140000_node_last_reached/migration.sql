-- Node health decays from the direction that matters: the panel reaching
-- the node, not the node reaching the panel. A heartbeat kept "lastSeenAt"
-- fresh every fifteen seconds, so a node the panel could not call back
-- read as HEALTHY until somebody tried to put a server on it.
ALTER TABLE "nodes" ADD COLUMN "lastReachedAt" TIMESTAMP(3);

-- What the panel already believed about existing nodes: they were being
-- polled, and their state was decided from this timestamp.
UPDATE "nodes" SET "lastReachedAt" = "lastSeenAt";
