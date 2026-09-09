-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "daemonToken" TEXT,
ADD COLUMN     "daemonUrl" TEXT;

-- AlterTable
ALTER TABLE "servers" ADD COLUMN     "containerId" TEXT;
