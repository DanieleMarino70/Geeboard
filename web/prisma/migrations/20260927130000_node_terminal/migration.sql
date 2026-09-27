-- The node terminal (0.3.5). A node says in every heartbeat whether the
-- machine allows a shell from the panel, and as whom; the panel keeps the
-- last answer beside the node. Null is an agent that has never said, which
-- is one from before the terminal existed.
ALTER TABLE "nodes" ADD COLUMN "terminal" JSONB;
