# Backups

Backups copy bytes. They did not always: until Phase 5 this model wrote a row
with a plausible size and a fabricated checksum, which is worse than having no
backups at all because somebody stops worrying on the strength of it.

## The sequence

```
Quiesce     the game's own save command, from its definition
Archive     the data directory, streamed to a tar.gz on the node
Hash        sha256 taken from the bytes on their way to disk
Record      size, checksum, artifact, duration
```

Flushing the world first is the difference between a backup and a copy of a
world halfway through a save. Every definition that has a save command names it
— `save-all` for Minecraft, `save` for Zomboid — and a game with none gets a
best-effort archive and a slightly less certain one.

The checksum is computed from the compressed stream as it is written, not by
reading the file back afterwards: one pass, and the digest describes exactly
what was written rather than what a later read happened to find.

## The archive

A gzipped tar, written by the node. Nothing passes through the panel — a
Minecraft world is gigabytes, and the panel never touches the bytes.

Written by hand rather than with a library, because the agent's only
dependencies are Docker and a WebSocket and adding an archive format to that
list to write a few hundred lines of POSIX header is a bad trade.

Two things it deliberately does:

- **Symlinks are skipped, not followed.** Following one copies whatever it
  points at into the archive — for a link out of the server's directory that
  means backing up somebody else's data, and for a link that loops it means
  never finishing.
- **Every entry is resolved inside the server's root on the way back out.** An
  archive is untrusted input even when the panel produced it, because nothing
  can prove the bytes on disk are the ones it wrote.

Archives live in `<dataRoot>/.backups/<serverId>/`, beside a server's data and
never inside it — inside would mean each backup archiving the previous ones,
and the directory doubling every night until the disk is full.

## Restoring

Destructive by design. The server is stopped, the directory is **replaced**
rather than merged into, and the server is started again if it was running.

A restore that left files the backup does not contain — a corrupt region, a
plugin added since — would not be a restore; it would be a state nobody has
ever tested.

The checksum recorded when the archive was written is checked again before a
single byte is replaced. A backup nobody verified is a hope, and that is the
moment it stops being one.

## Retention

A `LOCKED` backup is kept indefinitely and never counted by retention: locking
is an operator saying "this one specifically", and a policy that overrode that
would make locking meaningless.

A `CLEANUP` scheduled task prunes all but the newest N, where N comes from the
task's payload (`keep 7`, or just `7`). An unreadable payload falls back to
seven rather than to zero — a cleanup task that misreads its own configuration
must not delete everything.

## What this does not do

**Node-local storage is not off-site.** `store` says `LOCAL` because that is
what it is: a machine that dies takes its own backups with it. The column and
the `BackupStore` enum exist so that adding S3 is a migration and a new backend
rather than a rewrite, but today there is one backend and it is the node's own
disk.

Also missing: scheduled verification of archives that are sitting there, and
pre-delete backups. A backup taken before an update is supported
(`PRE_UPDATE`), but updates themselves are not implemented yet.
