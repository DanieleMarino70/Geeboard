-- What a mod's Workshop page lists as required, as [{ id, title }], asked
-- of Steam with a key. Null when not known, which is every mod on an
-- installation with no Steam Web API key.
ALTER TABLE "server_mods" ADD COLUMN     "requires" JSONB;
