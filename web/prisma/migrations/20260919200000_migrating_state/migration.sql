-- A server being moved between nodes is neither updating nor backing up,
-- and an operator reading the state should not have to guess which.
ALTER TYPE "ServerState" ADD VALUE 'MIGRATING';
