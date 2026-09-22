# Checks that need something this project's machine does not have

Everything offered in the panel has been run for real. Three things could not
be, for want of a game client, a cloud account or sixteen gigabytes, and this
page is what each of them needs — written so that somebody who has the missing
thing can do the check in an evening and know what to change afterwards.

## Player counts, with a real client

Player counts are read from each game's console with patterns in its
definition. Minecraft: Java Edition's were checked against a real client. The
other four were written from documentation, a known log, or the game's own
server code, and **nobody has seen them match a real player** — so their counts
on the Players page are unverified until this has been done.

For each game you own: a server of it running on a real node, the game itself
on any PC, and a second account or a friend for step 5.

| Game | Written from | `join` | `leave` |
| --- | --- | --- | --- |
| Terraria | documented output | `^(?<name>[^<>:]{1,20}) has joined\.$` | `^(?<name>[^<>:]{1,20}) has left\.$` |
| Minecraft: Bedrock | documented output | `Player connected: (?<name>[^,]{1,32}), xuid` | `Player disconnected: (?<name>[^,]{1,32}), xuid` |
| Project Zomboid | format strings in the server's code | `"(?<name>[^"]{1,50})" fully connected` | `Disconnected player "(?<name>[^"]{1,50})"` |
| Valheim | the server's known log | `connect`: `Got connection SteamID (?<id>\d{5,20})`, then `join`: `Got character ZDOID from (?<name>.{1,32}?) : -?\d+:\d+$` | `Closing socket (?<id>\d{5,20})` |

The checklist, per game:

1. Open the server's **Console** page and leave it open. Open **Players** in
   another tab, on that server.
2. Join with the game client. In the console, find the line the server printed
   for you and **copy it exactly** — that line is the evidence, whatever happens
   next.
3. Within one poll (fifteen seconds) Players should list you as online, under
   the name the game shows. Note what it shows: a wrong name, a name with a
   trailing character, or nothing.
4. Leave. Copy the line the server printed. Within one poll you should move from
   online to the history, with a session length of about how long you stayed.
5. With a second player: join both, leave in the opposite order, and check each
   session closed for the right person. For **Valheim** this is the step that
   matters, because a departure names only a Steam id and the panel pairs it with
   the name from the connect line.
6. Things that have fooled patterns before — try each once:
   - die and respawn (Valheim prints the character line again; it must not count
     as a second join)
   - say in chat the words of a join line (`Steve has joined.` typed by a player
     reaches Terraria's console as `<Name> Steve has joined.` and must not match)
   - a name with a space, an apostrophe, or non-Latin characters
   - stop the server with a player connected: their session should close at the
     stop, not stay open for ever
   - for Bedrock, a player on a console, whose name has a different shape
7. If a line did not match, the fix is one regular expression in
   `web/src/domain/games/definitions/<game>.ts`, a case added to
   `web/test/players.test.ts` **with the line you copied**, and the words "not
   yet seen with a real client" taken out of the definition's comment and of
   [games.md](games.md#console). If every line matched, only the last two.

What to send back if you are not changing the code yourself: the game and its
version, the copied lines, and what the Players page showed at steps 3–5.

## Off-site backups against a real provider

Off-site backups have been run against MinIO in Docker. The signer is checked
against Amazon's published examples, and MinIO is strict about signatures, but
**nothing has been run against Amazon S3 or any other hosted store**, and that is
where addressing style, regions, clock skew and bucket policies bite.

You need: a bucket made for this and nothing else, and a key pair that can
`PutObject`, `GetObject`, `DeleteObject` and `ListBucket` on it and nothing more.
For Amazon, an IAM policy scoped to `arn:aws:s3:::<bucket>` and
`arn:aws:s3:::<bucket>/*`. Do not use an account's root keys. A server with a
small world on a real node.

| Provider | Endpoint | Region | Addressing |
| --- | --- | --- | --- |
| Amazon S3 | `https://s3.<region>.amazonaws.com` | the bucket's, e.g. `eu-south-1` | virtual-hosted (path-style off) |
| Cloudflare R2 | `https://<account>.r2.cloudflarestorage.com` | `auto` | path-style |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | e.g. `eu-central-003` | either |
| Wasabi, Scaleway, Hetzner | the provider's S3 endpoint | the provider's | try virtual-hosted first |

The procedure. Each step says what it proves; stop at the first that fails and
keep the message, which carries the store's own error code.

1. **Backups → Off-site storage → Configure**, with the row above. Saving does a
   test upload and delete under the prefix. *Proves: the endpoint, the region in
   the signature, the addressing style, `PutObject` and `DeleteObject`.*
   `SignatureDoesNotMatch` means region or addressing; `AccessDenied` means the
   policy; `RequestTimeTooSkewed` means the panel host's clock.
2. Save it once more with a deliberately wrong secret. *Proves: a bad key is
   refused and not saved.*
3. **Back up now → Off-site** on the small server. *Proves: a presigned `PUT`
   from the node.* The node uploads, not the panel — so this is also where a
   node that cannot reach the provider shows up. In the provider's console, the
   object should be at `<prefix>/<serverId>/<artifact>` with the size the panel
   shows.
4. On the node, check `<dataRoot>/.backups/<serverId>/` no longer holds that
   archive. *Proves: an `S3` row means the bucket and nowhere else.*
5. The shield beside the backup (**Verify**). *Proves: `HEAD`, a presigned `GET`
   to the node, and that the bytes come back as they went.*
6. Change something in the world, then **Restore** that backup. *Proves: the
   download is hashed and the world is the old one.*
7. A scheduled backup with "send scheduled backups off-site" on, then a **Delete
   old backups** task keeping 1. *Proves: retention reaches the bucket — the
   older object is gone from the provider's console.*
8. Delete the remaining backup from its row. *Proves: `DeleteObject` by the
   panel's own signed request.*
9. If you have two nodes: **Settings → Move to another node**. *Proves: the
   second node can `GET` what the first `PUT`.*
10. Delete the small server with **Take a last backup off-site first** ticked,
    then restore `final-<date>` into another server of the same game.
11. Afterwards: bucket versioning or lifecycle rules change what "deleted"
    means. With versioning on, step 8 leaves a delete marker and the bytes stay,
    and are billed; the panel cannot see that and says so in
    [backups.md](backups.md#what-this-does-not-do).

What to send back: the provider, the row you used, and the first message that
was not a success. If all eleven pass, the sentence "nothing has been run against
Amazon" comes out of [backups.md](backups.md#off-site),
[limitations.md](limitations.md) and the roadmap, with the provider's name going
in instead.

## Rust, Palworld and Satisfactory

Parked: written, never run, not offered. What each needs before it can come
back, which is more than this project's machine gives its container engine
(7.7 GB):

| Game | Memory to boot it | The definition's own floors, unmeasured | Boot grace it assumes |
| --- | --- | --- | --- |
| Rust | 12–16 GB | 8 GB memory, 40 GB disk | 20 minutes, for map generation |
| Palworld | 16 GB | 8 GB memory, 10 GB disk | 10 minutes |
| Satisfactory | 12 GB | 6 GB memory, 10 GB disk | 10 minutes |

The memory figures are what these servers are commonly reported to need, and
the reason none of them was started here; the floors and graces are what the
parked definitions say, and every one of them is a guess until it has been run.

So: a Linux machine with 24 GB or more, registered as a node. Then the method in
[games.md](games.md#parked), which is the one every offered game went through
and which found bugs in every one of them — run the bare image by hand; find
where the world lands and make that the `dataPath`; find which variables the
image actually reads; find the ready line; find whether its console reads input
and whether SIGTERM saves; find what a restart downloads, and whether that wants
a cache mount; put its query protocol to it with `scripts/probe-query.mts`
(Rust's and Palworld's definitions declare A2S, Palworld's an RCON probe
nothing executes, Satisfactory's none — and Valheim showed that "speaks A2S" can
depend on a setting); correct the definition; create one from the wizard; drive it through
the panel — console, settings, backup, stop, restore, start; and only then put
its line back in `registry.ts`.

## Mods and the Workshop

Not a check but a boundary: `ModManager`, `WorkshopProvider`, and node-side
SteamCMD and download installers are Phase 6 and are not in the first release.
The Plugins and Marketplace pages say they are unavailable, and a server's
Plugins tab is disabled. Until then a plugin is a file: uploaded with
`PUT /api/v1/servers/:id/files/raw` or placed on the node, under the server's
directory.
