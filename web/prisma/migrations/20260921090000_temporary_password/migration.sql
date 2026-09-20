-- The first owner of an installation signs in with a temporary password
-- that stops working after a day.
ALTER TABLE "users" ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);
