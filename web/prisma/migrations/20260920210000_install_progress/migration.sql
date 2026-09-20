-- Where an install has got to, for the creation wizard to show while it waits.
ALTER TABLE "servers" ADD COLUMN "installKey" TEXT;
ALTER TABLE "servers" ADD COLUMN "installStep" TEXT;
ALTER TABLE "servers" ADD COLUMN "installMessage" TEXT;
CREATE UNIQUE INDEX "servers_installKey_key" ON "servers"("installKey");
