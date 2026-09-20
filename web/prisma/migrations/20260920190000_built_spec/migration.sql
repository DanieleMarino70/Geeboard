-- What each workload was made from, so a definition that changes what a
-- version runs can be noticed on the servers already running it.
ALTER TABLE "servers" ADD COLUMN "builtSpec" JSONB;
