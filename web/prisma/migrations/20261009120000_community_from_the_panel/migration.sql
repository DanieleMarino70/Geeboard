-- An owner can let community games run on a node from the panel, with a fresh two-factor code.
--
-- "communityDeclared" says the machine declares community-games itself (only the machine can take that away);
-- "communityGrantedAt" and "communityGrantedById" say an owner granted it from the panel, and who. The capabilities
-- column keeps holding the result, so placement reads one list as before. A node that declares it today is marked
-- declared here, so its page does not offer to take away what the machine gave.

ALTER TABLE "nodes" ADD COLUMN "communityDeclared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "communityGrantedAt" TIMESTAMP(3),
ADD COLUMN "communityGrantedById" TEXT;

UPDATE "nodes" SET "communityDeclared" = true WHERE 'community-games' = ANY("capabilities");
