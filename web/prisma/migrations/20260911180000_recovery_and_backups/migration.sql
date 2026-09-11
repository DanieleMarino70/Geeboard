-- Phase 5: crash recovery with a ceiling, and backups that are real.
--
-- `autoRestart` was a boolean, which cannot express the thing that
-- actually matters: how many times to try before admitting that
-- restarting is not going to fix it. A server that crashes on boot will
-- crash on boot again, and a policy with no ceiling turns one broken
-- world into a machine spending all night starting and killing the same
-- process.
--
-- The boolean is carried across and then dropped rather than kept
-- alongside. Two columns both meaning "should this restart" is the drift
-- problem in miniature: they would disagree eventually, and nothing
-- would say which one was right.

-- CreateEnum
CREATE TYPE "RestartPolicy" AS ENUM ('NEVER', 'ON_FAILURE', 'ALWAYS');

-- CreateEnum
CREATE TYPE "BackupStore" AS ENUM ('LOCAL', 'S3');

-- AlterEnum: a backup taken because an update was about to happen is
-- neither scheduled nor manual, and telling them apart is what makes a
-- retention policy able to keep the one that matters.
ALTER TYPE "BackupTrigger" ADD VALUE 'PRE_UPDATE';

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "restartPolicy" "RestartPolicy" NOT NULL DEFAULT 'ON_FAILURE',
ADD COLUMN     "maxRestarts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "restartAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastRestartAt" TIMESTAMP(3),
ADD COLUMN     "crashCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCrashAt" TIMESTAMP(3),
ADD COLUMN     "lastExitCode" INTEGER,
ADD COLUMN     "oomKilled" BOOLEAN NOT NULL DEFAULT false;

-- Carry the old flag across. A server that had automatic restart off
-- must not quietly gain it because the column changed shape.
UPDATE "servers" SET "restartPolicy" = 'NEVER' WHERE "autoRestart" = false;

ALTER TABLE "servers" DROP COLUMN "autoRestart";

-- AlterTable: where a backup's bytes actually are.
ALTER TABLE "backups" ADD COLUMN     "store" "BackupStore",
ADD COLUMN     "artifact" TEXT,
ADD COLUMN     "durationMs" INTEGER;
