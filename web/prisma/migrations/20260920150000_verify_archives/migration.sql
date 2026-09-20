-- A scheduled task that re-reads the archives sitting on a node or in the
-- bucket, and somewhere to write down what it found.
ALTER TYPE "TaskKind" ADD VALUE 'VERIFY';

ALTER TABLE "backups" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "backups" ADD COLUMN "verifyError" TEXT;
