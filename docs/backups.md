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

Three things it deliberately does:

- **A long path goes in a PAX header.** A USTAR entry's name holds 100 bytes,
  and the first Minecraft server run for real has paths of 148 under
  `libraries/`. The writer used to refuse them, so every Minecraft backup failed
  — shown in the table as "Verify failed", which it was not. A path over 100
  bytes is now carried by a PAX extended header, which GNU tar, bsdtar and
  Python all read, so an archive is never one only Geeboard can open. A restore
  reads PAX paths, GNU long names and the USTAR prefix field.
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

So it asks first, in words: which server's world is replaced by which snapshot,
and that everything since is lost. Deleting a snapshot asks too. Both used to
happen on one click of a small icon.

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

## Off-site

A workspace can name one S3-compatible bucket, on the Backups page: endpoint,
region, bucket, a prefix, path-style or virtual-hosted addressing, and a key
pair. Verified against MinIO in Docker on this PC (`quay.io/minio/minio`) and
the signer against Amazon's published examples; nothing has been run against
Amazon itself yet.

**Who holds what.** The panel holds the keys — encrypted at rest with the same
AES-256-GCM as a node token, written once, never shown back; the page shows the
bucket and a mask of the key id. A node never sees them. For each transfer the
panel signs a URL (Signature Version 4, written on `node:crypto` in
[`src/domain/storage/s3.ts`](../web/src/domain/storage/s3.ts) — the SDK is tens
of megabytes for one algorithm) that allows one `PUT` or one `GET` of one object
for an hour, and hands it to the node. The node streams the archive up or down
on that URL with `node:http`, Content-Length set, and the panel never touches
the bytes. The panel's own requests are small: a probe when the bucket is
configured or tested — a tiny object put under the prefix and deleted again,
because a key that can list cannot always write — and a `DELETE` when a backup
goes.

**The sequence, off-site.** Quiesce and archive exactly as before, on the node,
hashed on the way to disk. Then the node uploads the archive; the bucket's
answer is the verdict, and a byte count that differs from the archive's is a
failure. Once the bucket has it, the local copy is removed, so a row that says
`S3` means one thing: the bytes are in the bucket and nowhere else. The object
key is `<prefix>/<serverId>/<artifact>`, so a bucket listing reads like the
panel's own layout.

**Restoring from the bucket** pulls the archive down onto whichever node the
server is on *now*, hashing it on the way and refusing it if it does not match
the checksum recorded when it was made; then the ordinary restore runs, and the
fetched copy is removed. That is what makes a bucket a way to move a world
between machines.

**Where each backup goes.** *Back up now* asks, when a bucket is configured:
off-site or on the node. A scheduled backup follows the storage setting "send
scheduled backups off-site", on by default. A pre-update backup stays on the
node: it is a rollback point, and it wants to be where the rollback happens.

**A move is a backup too.** Moving a server to another node
([nodes.md](nodes.md#moving-a-server)) goes through the bucket: the archive it
makes, `move-<date>`, is locked while the move runs and stays afterwards as an
ordinary off-site backup. The local backups on the node being left go with the
node's copy of the server.

**Retention and deletion** reach both. A cleanup task removes an off-site
archive from the bucket by the panel's own signed `DELETE`; so does deleting
one by hand. With the bucket forgotten (**Remove** on the Backups page), the
rows stay and say so, the objects stay in the bucket, and an off-site backup
cannot be taken or restored until a bucket is configured again — a request
for one is refused, not quietly made local.

Exercised end to end by `npm run verify:backups`, which starts a MinIO of its
own: configure with wrong keys (refused), configure, back up off-site, check
the object from outside and the node's empty backup directory, restore, a
scheduled backup that follows the setting, retention, delete, forget.

## What this does not do

**One bucket, for the whole workspace.** Not one per server, not one per node.
Nothing checks the bucket's own retention or versioning rules; what the panel
deletes is deleted.

**A backup is either on its node or in the bucket, never both.** An off-site
archive is not also kept locally, and a local one is not copied up later; move
one by restoring it and backing it up again the other way.

A backup taken before an update is `PRE_UPDATE` and is **locked** while it is
still the way back — a cleanup task must not be the thing that decides whether a
rollback is possible. Rolling back unlocks it again, because the one way back
has then been taken.

Also missing: scheduled verification of archives that are sitting there, and
pre-delete backups.

**A backup contains the server's directory, and only that.** A game whose image
keeps its world anywhere other than `/data` produces an archive without the
world in it. Terraria was like that until its definition was fixed; the Steam
games have not been checked — see [games.md](games.md#shipped).

**Deleting a server deletes its backups**, rows and archives both. Nothing keeps
a copy of a deleted server's world; take one somewhere else first if it matters.
The archives used to survive on the node's disk with no rows pointing at them.

The storage figure on the Backups page is measured against the disks of the nodes
in service. It used to be a fixed 400 GB "pool" that no machine had reported.
