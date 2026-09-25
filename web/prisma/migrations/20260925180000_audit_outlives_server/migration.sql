-- The audit log outlives a server. Deleting a server used to delete every
-- event about it with the row, so its history went with it and only the
-- line saying it had been deleted remained. The link is now set to null
-- instead, and the server's id, name and slug are written onto its events
-- when it is deleted.
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_serverId_fkey";

ALTER TABLE "activity_events" ADD COLUMN     "originServerId" TEXT,
ADD COLUMN     "originServerName" TEXT,
ADD COLUMN     "originServerSlug" TEXT;

ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What is left of the servers deleted before this: the line that said so,
-- written without a link and with the server's name as its target.
UPDATE "activity_events" SET "originServerName" = "target"
WHERE "action" = 'server.deleted' AND "serverId" IS NULL AND "target" IS NOT NULL;
