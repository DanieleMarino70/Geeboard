-- The collection a mod came from, so the mods a collection added can be
-- removed as one. Null for a mod added on its own, and for the ones added
-- before this was kept, until their collection is pasted again.
ALTER TABLE "server_mods" ADD COLUMN     "collectionId" TEXT,
ADD COLUMN     "collectionTitle" TEXT;
