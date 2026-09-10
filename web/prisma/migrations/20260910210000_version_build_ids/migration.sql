-- Phase 2: build ids, because Steam games do not have version numbers.
--
-- Rust is the clearest case. There is no version string to compare —
-- Facepunch pushes a build to the `public` branch and every server is
-- suddenly out of date. The only thing that changed is the branch's
-- build id, so that is what has to be recorded when a server is
-- installed and compared when asking whether an update exists.
--
-- A build id is never compared against a version string. It is an
-- integer that only goes up within one branch, and letting it into a
-- version comparison would sort 17851234 above every real version a
-- game has ever had.

-- AlterTable: what a catalog version currently points at upstream.
ALTER TABLE "game_versions" ADD COLUMN     "branch" TEXT,
ADD COLUMN     "buildId" TEXT,
ADD COLUMN     "branchUpdatedAt" TIMESTAMP(3);

-- AlterTable: what this server was actually installed from.
ALTER TABLE "servers" ADD COLUMN     "installedBuildId" TEXT;
