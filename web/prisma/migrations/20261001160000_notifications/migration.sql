-- Where notifications go, what is waiting to be sent, and how far into the audit
-- log the dispatcher has read; and the update each server was last told about.
CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signingSecret" TEXT,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_channels_name_key" ON "notification_channels"("name");

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "DeliveryState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_deliveries_state_nextAttemptAt_idx" ON "notification_deliveries"("state", "nextAttemptAt");
CREATE INDEX "notification_deliveries_channelId_createdAt_idx" ON "notification_deliveries"("channelId", "createdAt");

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_cursor" (
    "id" TEXT NOT NULL DEFAULT 'events',
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_cursor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "servers" ADD COLUMN "updateNotifiedKey" TEXT;
