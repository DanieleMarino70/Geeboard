-- The DNS provider, one row or none; where a node is on the Internet;
-- and the record the panel keeps for each server's host.
CREATE TABLE "dns_provider" (
    "id" TEXT NOT NULL DEFAULT 'dns',
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "zoneId" TEXT,
    "checkHost" TEXT,
    "checkedAt" TIMESTAMP(3),
    "checkError" TEXT,
    "configuredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_provider_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "nodes" ADD COLUMN "publicAddress" TEXT;
ALTER TABLE "nodes" ADD COLUMN "observedAddress" TEXT;
ALTER TABLE "nodes" ADD COLUMN "observedAt" TIMESTAMP(3);

ALTER TABLE "servers" ADD COLUMN "dnsRecordId" TEXT;
ALTER TABLE "servers" ADD COLUMN "dnsAddress" TEXT;
ALTER TABLE "servers" ADD COLUMN "dnsCheckedAt" TIMESTAMP(3);
ALTER TABLE "servers" ADD COLUMN "dnsError" TEXT;
