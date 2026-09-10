# Backups

## What exists

A `Backup` model, a UI, a scheduler, retention locking, and an audit trail. The
daily backup schedule is created with every server, so a server that says it is
backed up nightly really does have the task.

## What does not

**Nothing is copied anywhere.** `createBackupOp` writes a row with a plausible
size and a fabricated checksum. Restore stops the server and writes an event.
Deleting removes the row.

This is stated plainly because a backup you believe in and do not have is worse
than no backup at all. Until Phase 5, back up your nodes' data directories by
whatever means you already trust.

## What it will be

```
Manual · scheduled · pre-update · pre-delete
Retention policy · verification · restore
```

Storage is abstracted from the start, because tying archives to the node's local
disk means a node failure takes its backups with it:

```
Local disk · S3-compatible · object storage · remote backup server
```

The sequence, once the archive is real:

```
Quiesce      the game's own save command from its ConsoleDialect
Archive      the server's data directory, streamed to the backend
Verify       checksum on the way in, checked on the way out
Record       size, checksum, backend, duration
```

`saveCommand` in each game definition exists for the first step — flushing the
world to disk before copying it is the difference between a backup and a
corrupt world.

## Retention

A `LOCKED` backup is kept indefinitely and skipped by retention. Unlocking
returns it to the policy. That much works today, on records.

## Where it lands

Phase 5, after the installer work in Phase 2 — the same file-transfer path
serves both, and building it twice would be the wrong order.
