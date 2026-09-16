-- When a server's console last said it was ready.
--
-- A log health probe reads a window of recent output, and a busy server
-- pushes its ready line out of that window within minutes — Terraria,
-- which is judged on its console alone because a port probe crashes it,
-- went UNHEALTHY for having players. Readiness happens once per run, so
-- the poller records when it saw it, and the check counts it for a run
-- that started before it.

-- AlterTable
ALTER TABLE "servers" ADD COLUMN "readyAt" TIMESTAMP(3);
