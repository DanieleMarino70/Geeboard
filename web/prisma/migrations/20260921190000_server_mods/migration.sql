-- Mods on a server: one row per Steam Workshop item the operator chose.
-- The panel never holds a mod's bytes — the game downloads them on the
-- node from the ids it is told — so a row is the choice and the answer
-- the node gave back: which mod ids that download turned out to contain.
CREATE TABLE "server_mods" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "previewUrl" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "modIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "server_mods_pkey" PRIMARY KEY ("id")
);

-- One row per item per server: adding the same Workshop item twice is
-- the same mod, not a second one.
CREATE UNIQUE INDEX "server_mods_serverId_workshopId_key" ON "server_mods"("serverId", "workshopId");
CREATE INDEX "server_mods_serverId_idx" ON "server_mods"("serverId");

-- A deleted server takes its mod list with it; a deleted account leaves
-- the mods it added behind, with nobody's name on them.
ALTER TABLE "server_mods" ADD CONSTRAINT "server_mods_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_mods" ADD CONSTRAINT "server_mods_addedById_fkey"
    FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What was last written into a server's settings as its mods, so the
-- panel can tell a choice that has been applied from one that has not
-- without reading a file off the node to render a page.
ALTER TABLE "servers" ADD COLUMN "modItemsApplied" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "servers" ADD COLUMN "modIdsApplied" TEXT[] DEFAULT ARRAY[]::TEXT[];
