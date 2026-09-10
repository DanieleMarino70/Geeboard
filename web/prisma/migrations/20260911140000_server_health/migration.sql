-- Phase 4: what the last health check found, and when.
--
-- Separate from `state` because a server can be running and unhealthy at
-- the same time, and the two facts have different lifetimes: the state
-- changes when somebody acts on the server, the verdict changes every
-- time the watchdog looks. Keeping the reason is the point — "unhealthy"
-- on its own is not something anybody can act on.

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "healthCheckedAt" TIMESTAMP(3),
ADD COLUMN     "healthDetail" TEXT;
