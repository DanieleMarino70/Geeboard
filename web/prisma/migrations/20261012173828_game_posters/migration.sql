-- 0.12.0: each game Geeboard ships shows its real poster, fetched once by the panel and kept here.
--
-- game_posters is one row per game, written by the poller from where the game's definition says its poster is (Steam's CDN by the store
-- app id, or a fixed address with the image's sha256) and read by the pages, which never ask the network. In the database so that the
-- nightly dump, restore-panel.sh and a new machine carry it with nothing else to copy. A table added and nothing changed: a panel rolled
-- back to 0.11.0 does not read it, and draws every cover as it did.

CREATE TABLE "game_posters" (
    "gameId" TEXT NOT NULL,
    "bytes" BYTEA,
    "contentType" TEXT,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sourceUrl" TEXT,
    "sourceKey" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "etag" TEXT,
    "lastModified" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_posters_pkey" PRIMARY KEY ("gameId")
);
