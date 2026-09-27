-- Why the panel could not reach a node, kept beside the node (0.3.5). The
-- heartbeat's call-back found it out and told only the agent; the Add a
-- node dialog said "waiting" while the machine's log said why. Null once
-- a call gets through.
ALTER TABLE "nodes" ADD COLUMN "reachDetail" TEXT;
