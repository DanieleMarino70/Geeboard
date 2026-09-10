-- Two servers on one node cannot hold the same port. Allocation looks
-- for a free one and then writes; this is what makes losing that race a
-- failed insert to retry rather than two servers bound to one address.
CREATE UNIQUE INDEX "servers_nodeId_port_key" ON "servers"("nodeId", "port");
