-- 0.9.0: deleting a server does not read the whole audit log.
--
-- `activity_events.serverId` is a foreign key (ON DELETE SET NULL, so the audit outlives the server) with no index of its own. Deleting a
-- server marks its history first (keepHistoryOf, an UPDATE by serverId) and then the foreign key's own trigger looks for the same rows
-- again: two scans of the whole table inside the delete's transaction, on a table that only grows. Measured on 1 000 000 events, for a
-- server with 100 of them: 98 ms for each scan without the index and 2.6 ms with it.

CREATE INDEX "activity_events_serverId_idx" ON "activity_events"("serverId");
