-- AlterTable
ALTER TABLE "activity_events" ADD COLUMN     "changes" JSONB;

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "autoRestart" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autosave" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "javaFlags" TEXT,
ADD COLUMN     "motd" TEXT,
ADD COLUMN     "whitelist" BOOLEAN NOT NULL DEFAULT false;
