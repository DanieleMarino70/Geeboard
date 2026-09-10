-- Phase 3: nodes register themselves, and somebody approves them.
--
-- Attaching a node used to mean encrypting a token by hand and writing
-- it into this table with SQL. That is a credential handled outside any
-- flow that could audit or revoke it, which is the wrong way round for
-- the one secret that grants control of every container on a machine.
--
-- A registration token replaces it: minted in the panel, shown once,
-- single-use, expiring, revocable. The node presents it, sends its own
-- agent token, and lands as PENDING until an admin says yes — because a
-- machine that registered with a stolen token must not become useful by
-- simply waiting.

-- AlterEnum
ALTER TYPE "NodeState" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "registeredAt" TIMESTAMP(3);

-- Nodes that already exist were attached by hand, by somebody with
-- database access. Backdating their approval to their creation is the
-- honest record: they were approved, just not through a flow that
-- existed yet. Leaving it null would take every running node out of
-- service on migrate, which is not an acceptable way to introduce a
-- feature.
UPDATE "nodes" SET "approvedAt" = "createdAt", "registeredAt" = "createdAt";

-- CreateTable
CREATE TABLE "node_registration_tokens" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByNode" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_registration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "node_registration_tokens_expiresAt_idx" ON "node_registration_tokens"("expiresAt");
