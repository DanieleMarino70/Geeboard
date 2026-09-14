-- A registration token now names the node it is for.
--
-- Re-registering an existing name keeps that node's approval, which is
-- how a machine is rebuilt or its agent token rotated. With a token that
-- accepted any name, that same rule let whoever held a leaked token
-- re-point an approved node at a machine of their choosing, and the
-- panel would carry on sending it servers. Bound to one name, a token
-- minted for a new node cannot touch an existing one; rotating a node
-- is minting a token for its name, which somebody has to decide to do.
--
-- Nullable so the tokens already minted keep working until they expire,
-- which is at most a week.

-- AlterTable
ALTER TABLE "node_registration_tokens" ADD COLUMN "nodeName" TEXT;
