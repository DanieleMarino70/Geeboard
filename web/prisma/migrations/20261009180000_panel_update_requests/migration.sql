-- The Updates page's button. The panel cannot upgrade itself, so an owner's request is a row, and the machine's updater
-- (deploy/linux/self-update.sh, a systemd timer the installer sets) reads it, runs the installer for that release and writes
-- back how it went. "updaterSeenAt" is when that updater last looked, which is how the page knows there is one.

ALTER TABLE "update_checks" ADD COLUMN "updaterSeenAt" TIMESTAMP(3);

CREATE TABLE "panel_update_requests" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "log" TEXT,

    CONSTRAINT "panel_update_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "panel_update_requests_state_requestedAt_idx" ON "panel_update_requests"("state", "requestedAt");
