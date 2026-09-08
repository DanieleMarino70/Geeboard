-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('BACKUP', 'RESTART', 'BROADCAST', 'CLEANUP', 'COMMAND');

-- CreateEnum
CREATE TYPE "RunResult" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED', 'NEVER_RUN');

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "cron" TEXT NOT NULL,
    "payload" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" "RunResult" NOT NULL DEFAULT 'NEVER_RUN',
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_serverId_enabled_idx" ON "scheduled_tasks"("serverId", "enabled");

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
