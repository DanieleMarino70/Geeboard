-- What the node found inside a Workshop download: every mod directory,
-- the folders in it and each mod.info with the game versions it declares.
-- Build 42 keeps a mod's mod.info in a folder per game version, and which
-- one a server loads depends on the server's build — so the panel keeps
-- what the node saw and judges it against the build, rather than keeping
-- a verdict that an update would make stale. Null until the node answers.
ALTER TABLE "server_mods" ADD COLUMN "contents" JSONB;
