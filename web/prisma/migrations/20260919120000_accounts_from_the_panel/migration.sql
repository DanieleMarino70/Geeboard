-- Accounts made from the panel, password reset, two-factor sign-in.
--
-- `users.twoFactor` existed and nothing read it; the seed set it on two
-- fixtures for the look of the thing. It now means what it says — a code
-- is asked for after the password — so it is cleared everywhere: nobody
-- has enrolled yet, and an account marked on with no secret could never
-- sign in again.
ALTER TABLE "users"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpLastStep" INTEGER,
  ADD COLUMN "passwordSetAt" TIMESTAMP(3);

UPDATE "users" SET "twoFactor" = false;

-- Every existing account has a password somebody chose — the seed's, or
-- one set through db:studio — so none of them is waiting on a setup link.
UPDATE "users" SET "passwordSetAt" = "createdAt";

CREATE TYPE "AccountTokenPurpose" AS ENUM ('SETUP', 'RESET');

CREATE TABLE "account_tokens" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "purpose"     "AccountTokenPurpose" NOT NULL,
  "hash"        TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "usedAt"      TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_tokens_hash_key" ON "account_tokens"("hash");
CREATE INDEX "account_tokens_userId_idx" ON "account_tokens"("userId");

ALTER TABLE "account_tokens"
  ADD CONSTRAINT "account_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "account_tokens_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "recovery_codes" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "hash"      TEXT NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recovery_codes_hash_key" ON "recovery_codes"("hash");
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

ALTER TABLE "recovery_codes"
  ADD CONSTRAINT "recovery_codes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
