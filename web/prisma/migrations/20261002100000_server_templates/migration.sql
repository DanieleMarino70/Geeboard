-- Starting points that somebody saved from a server that exists: its settings, its limits and its version.
CREATE TABLE "server_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "memoryGb" INTEGER NOT NULL,
    "cpuLimit" INTEGER NOT NULL,
    "diskGb" INTEGER NOT NULL,
    "versionLabel" TEXT,
    "versionSlug" TEXT,
    "sourceName" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "server_templates_gameId_name_key" ON "server_templates"("gameId", "name");
