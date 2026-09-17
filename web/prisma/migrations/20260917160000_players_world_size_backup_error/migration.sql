-- Three things the panel showed and never had.
--
-- Players: "0 / 40 online" on every server, because nothing read who
-- joined. The poller now reads join and leave lines from a server's
-- console, and remembers the last line it read so none is counted twice.
--
-- World size: "0 B" on every server, because nothing measured it. The
-- poller now asks the node for the size of the server's directory, now
-- and then, and keeps the figure and when it was taken.
--
-- Backup errors: a failed backup said "Failed" and not why; the reason
-- was only in the activity log.

-- AlterTable
ALTER TABLE "servers" ADD COLUMN "logCursorAt" TIMESTAMP(3),
ADD COLUMN "worldSizeBytes" BIGINT,
ADD COLUMN "worldSizeAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "backups" ADD COLUMN "error" TEXT;
