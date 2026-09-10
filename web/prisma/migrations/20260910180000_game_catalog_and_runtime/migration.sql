-- Phase 1: the game catalog, and Docker demoted to a runtime.
--
-- Two things happen here. A Game and its GameVersions become real rows,
-- so a server can point at a version rather than carrying a label and
-- hoping; and `servers.containerId` becomes `servers.runtimeId` beside a
-- `runtime` column, because which runtime a node uses is the node's
-- business and the rest of the platform should not be written as though
-- it will always be Docker.
--
-- The rename is a rename, not a drop and an add: every existing server
-- keeps the handle its node knows it by. Getting that wrong would strand
-- a running container behind a panel that could no longer address it.

-- CreateEnum
CREATE TYPE "RuntimeKind" AS ENUM ('DOCKER');

-- CreateEnum
CREATE TYPE "VersionSource" AS ENUM ('STATIC', 'STEAM', 'GITHUB', 'OFFICIAL', 'REGISTRY', 'MANUAL');

-- CreateEnum
CREATE TYPE "VersionChannel" AS ENUM ('STABLE', 'SNAPSHOT', 'PREVIEW', 'LEGACY');

-- AlterEnum
-- The server lifecycle the panel can actually observe. Postgres 12 and
-- later accept several ADD VALUEs in one transaction as long as none of
-- them is used before it commits — nothing below uses them.
ALTER TYPE "ServerState" ADD VALUE 'CREATING';
ALTER TYPE "ServerState" ADD VALUE 'INSTALLING';
ALTER TYPE "ServerState" ADD VALUE 'UNHEALTHY';
ALTER TYPE "ServerState" ADD VALUE 'RESTARTING';
ALTER TYPE "ServerState" ADD VALUE 'UPDATING';
ALTER TYPE "ServerState" ADD VALUE 'BACKING_UP';
ALTER TYPE "ServerState" ADD VALUE 'DELETING';
ALTER TYPE "ServerState" ADD VALUE 'ERROR';

-- AlterEnum
ALTER TYPE "NodeState" ADD VALUE 'MAINTENANCE';

-- AlterTable: what a node is, beyond its load figures.
ALTER TABLE "nodes" ADD COLUMN     "arch" TEXT,
ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "os" TEXT,
ADD COLUMN     "runtime" "RuntimeKind" NOT NULL DEFAULT 'DOCKER';

-- Every node registered so far runs the Docker agent, which is the only
-- runtime there is. Saying so is more useful than an empty list that
-- would read as "this node can do nothing".
UPDATE "nodes" SET "capabilities" = ARRAY['docker']::TEXT[] WHERE "daemonUrl" IS NOT NULL;

-- AlterTable: a server points at its catalog entry and carries its own
-- settings, and its runtime handle stops being called a container.
ALTER TABLE "servers" RENAME COLUMN "containerId" TO "runtimeId";

ALTER TABLE "servers" ADD COLUMN     "config" JSONB,
ADD COLUMN     "gameId" TEXT,
ADD COLUMN     "gameVersionId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "runtime" "RuntimeKind" NOT NULL DEFAULT 'DOCKER';

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "art" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "popularity" TEXT NOT NULL DEFAULT '',
    "portBase" INTEGER NOT NULL,
    "portSpan" INTEGER NOT NULL,
    "requires" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memoryGbMin" INTEGER NOT NULL DEFAULT 1,
    "diskGbMin" INTEGER NOT NULL DEFAULT 1,
    "retiredAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_versions" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "upstream" TEXT,
    "source" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "channel" "VersionChannel" NOT NULL DEFAULT 'STABLE',
    "origin" "VersionSource" NOT NULL DEFAULT 'STATIC',
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMP(3),
    "checksum" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "games_family_idx" ON "games"("family");

-- CreateIndex
CREATE INDEX "game_versions_gameId_supported_idx" ON "game_versions"("gameId", "supported");

-- CreateIndex
CREATE UNIQUE INDEX "game_versions_gameId_slug_key" ON "game_versions"("gameId", "slug");

-- CreateIndex
CREATE INDEX "servers_gameId_idx" ON "servers"("gameId");

-- AddForeignKey
ALTER TABLE "game_versions" ADD CONSTRAINT "game_versions_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retiring a game must never take its servers with it, which is why
-- both of these set null rather than cascading.
-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servers" ADD CONSTRAINT "servers_gameVersionId_fkey" FOREIGN KEY ("gameVersionId") REFERENCES "game_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
