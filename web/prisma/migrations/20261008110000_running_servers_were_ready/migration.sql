-- A server's "readyAt" is the moment its console first said it was ready in the run it is in, kept so that the health check still knows
-- after the line has scrolled out of the 120 lines it reads (a busy server pushes it out within minutes). A panel before 0.5 did not
-- always write it: a server that was RUNNING when the panel was upgraded came back UNHEALTHY ("the console has not reported it ready")
-- as soon as its log had outgrown that window, and stayed so until somebody restarted it. It was found upgrading a 0.4.1 panel with two
-- Terraria servers on it, one of which was never restarted.
--
-- A server the previous panel judged RUNNING was ready in the run it is in: that judgement is what is written down. UNHEALTHY and every
-- other state are left as they are, to be looked at. This only fills a column that was null; nothing is dropped or changed in shape.
UPDATE "servers" SET "readyAt" = "startedAt" WHERE "state" = 'RUNNING' AND "readyAt" IS NULL AND "startedAt" IS NOT NULL;
