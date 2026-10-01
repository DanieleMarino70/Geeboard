-- The contract number an agent reports, beside the version it reports: what it speaks to the panel,
-- apart from which release it is. Null for every agent there is now — none of them sends one — which
-- is then judged by its release line, exactly as before.
ALTER TABLE "nodes" ADD COLUMN "contract" INTEGER;
