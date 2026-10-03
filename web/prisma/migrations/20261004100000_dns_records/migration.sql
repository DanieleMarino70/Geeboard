-- 0.7.0: a server's DNS records are rows, one for each kind, instead of four columns for one.
--
-- A server could have one address record: its id at the provider, the address last written, when the panel
-- last tried and why that failed, in four columns of `servers`. It can now have an A record, an AAAA record
-- and an SRV record, each with the name it is at, so the columns become a table. What was written is copied
-- across first: the kind is read off the address, the name is the server's host, and nothing is written
-- to the provider or asked of it. A server that had only an error and no address gets no row, and is tried
-- again by the poller, which is where it would have been tried anyway.

CREATE TABLE "server_dns_records" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerRecordId" TEXT,
    "content" TEXT,
    "checkedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "server_dns_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "server_dns_records_serverId_kind_key" ON "server_dns_records"("serverId", "kind");

ALTER TABLE "server_dns_records" ADD CONSTRAINT "server_dns_records_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "server_dns_records" ("id", "serverId", "kind", "name", "providerRecordId", "content", "checkedAt", "error")
SELECT 'mig_' || md5("id" || '-dns'),
       "id",
       CASE WHEN "dnsAddress" LIKE '%:%' THEN 'AAAA' ELSE 'A' END,
       "host",
       "dnsRecordId",
       "dnsAddress",
       "dnsCheckedAt",
       "dnsError"
FROM "servers"
WHERE "dnsAddress" IS NOT NULL;

ALTER TABLE "servers" DROP COLUMN "dnsRecordId",
DROP COLUMN "dnsAddress",
DROP COLUMN "dnsCheckedAt",
DROP COLUMN "dnsError";

ALTER TABLE "nodes" ADD COLUMN "publicAddress6" TEXT;
