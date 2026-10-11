-- 0.11.0: a server's secret settings (a join password, Garry's Mod's game server login token) are sealed with SECRETS_KEY, like a
-- node's token, in a column of their own.
--
-- Only the column is added here: which settings are secret is the game definition's to say, and the key is not the database's, so the
-- values are sealed by the poller when it starts (lib/server-secrets.ts) and by every save after it. The clear copy in "config" stays
-- where it is for one more release, because 0.10.1 reads it there: a panel rolled back to it must still give the game the password.

ALTER TABLE "servers" ADD COLUMN "secretSettings" TEXT;
