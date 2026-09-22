-- The Steam Web API key, set from the Mods tab rather than the panel's
-- environment. One row or none, encrypted like the bucket's secret; the
-- environment variable still wins when both are set.
CREATE TABLE "workshop_key" (
    "id" TEXT NOT NULL DEFAULT 'steam',
    "apiKey" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "checkError" TEXT,
    "configuredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_key_pkey" PRIMARY KEY ("id")
);
