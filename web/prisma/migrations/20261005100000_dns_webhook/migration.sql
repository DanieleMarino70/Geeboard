-- 0.8.0: a DNS provider can be a webhook, which has an address of its own.
--
-- A webhook's address is encrypted like the token beside it, since it can hold a secret in its path.
-- The column is empty for Cloudflare and DuckDNS, which have fixed hosts in the code, and for any row
-- that was there before. The kind is a free string, so the new kind needs nothing else.

ALTER TABLE "dns_provider" ADD COLUMN "endpoint" TEXT;
