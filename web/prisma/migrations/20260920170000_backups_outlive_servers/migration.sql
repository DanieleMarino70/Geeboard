-- An off-site archive outlives the server it was taken from, so its row
-- has to be able to. The foreign key stops cascading and starts setting
-- null; deleting a server removes its local backup rows itself, and
-- writes what the off-site ones were a backup of into the origin columns.
ALTER TYPE "BackupTrigger" ADD VALUE 'PRE_DELETE';

ALTER TABLE "backups" DROP CONSTRAINT "backups_serverId_fkey";
ALTER TABLE "backups" ALTER COLUMN "serverId" DROP NOT NULL;
ALTER TABLE "backups" ADD COLUMN "originServerId" TEXT;
ALTER TABLE "backups" ADD COLUMN "originServerName" TEXT;
ALTER TABLE "backups" ADD COLUMN "originGameId" TEXT;
ALTER TABLE "backups" ADD COLUMN "originOwnerId" TEXT;
ALTER TABLE "backups" ADD CONSTRAINT "backups_serverId_fkey"
  FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
