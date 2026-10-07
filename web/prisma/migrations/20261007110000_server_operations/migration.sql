-- 0.9.0: a server that an operation holds says which, whose and since when, and whether its owner is alive.
--
-- UPDATING, BACKING_UP and MIGRATING were cleared only by the operation reaching its last line. Nothing claimed the server before
-- it began (two backups at once left it "Backing up" for ever, and a delete or a restore could start under an update), nothing
-- recorded that anyone was still working, and the poller, which does not look at a server in one of those states, did not look at
-- it again. These columns are written when an operation claims the server, kept fresh while it runs, and read by a reaper that
-- gives the server back when the process that held it is gone.

ALTER TABLE "servers" ADD COLUMN "operation" TEXT,
ADD COLUMN "operationOwner" TEXT,
ADD COLUMN "operationStartedAt" TIMESTAMP(3),
ADD COLUMN "operationBeat" TIMESTAMP(3),
ADD COLUMN "stateBefore" "ServerState";
