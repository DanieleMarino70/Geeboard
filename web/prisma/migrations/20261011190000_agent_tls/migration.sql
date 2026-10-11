-- 0.11: the panel calls an agent over https, pinned to the certificate the agent sent when it registered (lib/agent-tls.ts).
-- Null for a node whose agent has sent none, which the panel calls over plain http as before. Added only: a panel rolled back
-- to 0.10.1 does not read it, and reaches the agent over the plain http it still answers.

ALTER TABLE "nodes" ADD COLUMN "tlsFingerprint" TEXT;
