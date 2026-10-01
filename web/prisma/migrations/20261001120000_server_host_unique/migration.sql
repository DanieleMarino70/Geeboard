-- A server's address is a DNS name. A DNS name has no case, and two servers
-- cannot share one: they would fight over its record. Until now the address was
-- stored as typed and compared exactly, so "Aurora.example.com" and
-- "aurora.example.com" were two servers on one name, and two creates at the same
-- moment on different nodes could both pass the check in the code.
--
-- Nothing is changed unless every address is already its own. If some are not,
-- this stops and names them, so nobody has to guess which server to change.
DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(address || ': ' || names, '; ' ORDER BY address) INTO clash
  FROM (
    SELECT lower("host") AS address, string_agg("name", ', ' ORDER BY "name") AS names
    FROM "servers"
    GROUP BY lower("host")
    HAVING count(*) > 1
  ) AS duplicates;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Every server needs an address of its own, and these share one (case aside): %. Change the address of all but one of each in the panel (a server''s Settings, Address), then run the migration again.', clash;
  END IF;
END
$$;

UPDATE "servers" SET "host" = lower("host") WHERE "host" <> lower("host");

ALTER TABLE "servers" ADD CONSTRAINT "servers_host_lower" CHECK ("host" = lower("host"));

CREATE UNIQUE INDEX "servers_host_key" ON "servers"("host");
