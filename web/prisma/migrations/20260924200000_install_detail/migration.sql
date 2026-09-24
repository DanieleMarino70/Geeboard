-- What a download has counted while it runs: layers and bytes, as the
-- node reports them from Docker's own stream. The step and its sentence
-- were already here; the numbers let the page waiting on an install draw
-- a bar that means something. Cleared with the rest when the install ends.
ALTER TABLE "servers" ADD COLUMN "installDetail" JSONB;
