-- The definition a community manifest last validated into, kept beside it: a rule added later cannot take an approved game out of the registry
-- under its servers. Null until the first load that saw the manifest pass; nothing reads it as anything but "use this when the checks changed".
ALTER TABLE "game_manifests" ADD COLUMN "definition" JSONB;
