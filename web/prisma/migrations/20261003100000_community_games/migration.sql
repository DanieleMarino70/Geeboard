-- Games that came from a manifest: each revision somebody proposed and what became of it, and the
-- workspace's list of registries an image may come from.
CREATE TYPE "ManifestState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'RETIRED');

CREATE TABLE "game_manifests" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "state" "ManifestState" NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "game_manifests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_manifests_gameId_revision_key" ON "game_manifests"("gameId", "revision");
CREATE INDEX "game_manifests_state_idx" ON "game_manifests"("state");

CREATE TABLE "community_policy" (
    "id" TEXT NOT NULL DEFAULT 'policy',
    "registries" TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_policy_pkey" PRIMARY KEY ("id")
);
