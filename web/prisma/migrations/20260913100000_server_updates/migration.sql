-- Phase 5, finished: updates that can be undone.
--
-- The panel could already tell an operator an update existed and had no
-- button, because performing one safely means a backup, a stop, an
-- install, a start and a way back — and a way back needs somewhere to
-- record what the server was on before.
--
-- The backup id is kept here rather than only on the backup row, so a
-- retention policy sweeping old archives is not the thing that quietly
-- decides whether a rollback is still possible. `pruneBackups` skips
-- locked backups, and an update locks the one it takes.

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "rollbackVersionId" TEXT,
ADD COLUMN     "rollbackVersionLabel" TEXT,
ADD COLUMN     "rollbackBackupId" TEXT,
ADD COLUMN     "rollbackAt" TIMESTAMP(3);
