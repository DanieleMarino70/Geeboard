-- Columns nothing read.
--
-- `motd`, `javaFlags`, `autosave` and `whitelist` were settings-form
-- fields that were stored and never reached a game: what a game reads
-- lives in its own config, rendered from its definition. `worldSize` was
-- a formatted copy of `worldSizeBytes`, which is the measurement.
ALTER TABLE "servers"
  DROP COLUMN "motd",
  DROP COLUMN "javaFlags",
  DROP COLUMN "autosave",
  DROP COLUMN "whitelist",
  DROP COLUMN "worldSize";
