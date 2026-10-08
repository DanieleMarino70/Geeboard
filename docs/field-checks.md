# Checks that need something this project's machine does not have

Everything offered in the panel has been run for real. These could not
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

Off-site backups have been run against MinIO and SeaweedFS in Docker, and against a real
**Backblaze B2** bucket (below). The signer is checked against Amazon's published examples,
but **nothing has been run against Amazon S3, Cloudflare R2 or any other hosted store**, and
that is where addressing style, regions, clock skew and bucket policies bite.

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

The form (**Where is the bucket?**) has the first three by name, and fills in what is in the
table: for Amazon and Backblaze the region comes from the endpoint, and a region that
contradicts it is refused before anything is sent, with the right one. Anything else is
*MinIO, SeaweedFS or another store*. **For Backblaze B2**: make the bucket private, make an
application key for that bucket alone with read and write — its `keyID` is the access key id and
its `applicationKey`, shown once, is the secret — and, before step 8, set the bucket's lifecycle
to *keep only the last version*; with the default, step 7 and step 8 leave hidden versions behind
and the bucket's size does not go down, which is what step 11 is about.

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

**Backblaze B2, run on 2026-10-04.** A private bucket in eu-central-003, an application key for that bucket
alone with read and write, and the lifecycle rule *keep only the last version*. Not by hand: the off-site half
of `verify:backups` was pointed at the bucket with `GEEBOARD_VERIFY_STORE`, the path of a JSON file kept outside
the repository — `{"endpoint", "bucket", "keyId", "applicationKey"}`, and `"pathStyle": true` for path-style —
under a prefix the run makes up, so that what is left in the bucket is known to be the run's. It covers the
steps above that need no second machine, and the move of step 9 between two agents on one PC. **The first save
failed**: `411 MissingContentLength`, since the panel's own test upload was sent chunked, which a local store
takes and B2 does not. Fixed, and tested with a request that must carry its length. Then 147 checks passed,
virtual-hosted, and 147 again path-style, and what each run left was removed with Backblaze's own API
(`b2_delete_file_version`), since a `DELETE` through S3 hides and does not delete. Step 11, measured: with the
lifecycle rule, every deleted archive was still in the bucket as a version, with a hide marker beside it, after
the run; the rule removes it a day later. Not run: Amazon S3 and Cloudflare R2, each of which asks for what its
row in the table says.

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

Not a check but a boundary. Geeboard installs mods for one game, Project Zomboid, through the
Mods tab and the API ([servers.md](servers.md)); it does not for any other. A general
`ModManager` and `WorkshopProvider`, and node-side SteamCMD and download installers, are not
built, and the Plugins page says which games have mods and which do not. For every other game a
plugin is a file: dropped into the server's **Files** page, uploaded with
`PUT /api/v1/servers/:id/files/raw`, or placed on the node, under the server's directory.

## The official Minecraft client, through a record

What has been seen: a protocol client (`minecraft-protocol`, the library most bots use) resolved `mc3.geeboard.party` through the `_minecraft._tcp` SRV record the panel wrote
at Cloudflare, with **no port typed**, and connected to `207.180.193.183:25568`, which is the record's port and not the default; the panel counted it as 1 / 40 within a poll and
the Players page listed it joining and leaving. What has **not** been seen is the game itself. The official launcher resolves SRV records the same way, but nobody on this project has
sat in front of it with the panel's address in the box.

You need: a Minecraft: Java Edition account and a server the panel made, with an address at a DNS zone the panel manages through a provider that can hold an SRV record (Cloudflare, or a webhook: DuckDNS holds an A and an AAAA and no SRV),
on a port that is not 25565.

1. Make the server and wait for it to say *Running* and the address to say its records are *set* (the DNS section of the server's page).
2. In the launcher: **Multiplayer → Add Server**, the address **without** the port, e.g. `mc.example.com`. The box must not say `:25568`.
3. The server should show its name and *x / 40* within a few seconds. Join it.
4. On the panel: the server's tile reads 1 online, the Players page lists you, and the Console shows the join line.
5. Leave, and the history shows a session of about the time you stayed.

If step 3 shows *Can't resolve hostname* or hangs on the default port, say which resolver the PC uses and the output of
`nslookup -type=SRV _minecraft._tcp.mc.example.com` from the same PC. What to send back otherwise: the launcher's version, the server's version, and a screenshot of the panel at step 4.

## IPv6, from a network that has it

What has been seen: on the test machine the panel wrote the `AAAA` record, `docker-proxy` listens on `[::]:25568`, the machine connects to its own global IPv6 address, and
`ip6tables` accepts the port. What has not: **another network reaching it** (the external checker that was tried cannot resolve a name that has only an `AAAA` record, and the
test machine's network is the only one with an IPv6 address on this project). A record named `v6only.geeboard.party` with an `AAAA` and nothing else exists for exactly this.

You need: a phone on mobile data with IPv6 (or any connection that has it, checked at <https://test-ipv6.com>), and a server made by the panel at a name with an `AAAA` record.

1. On the phone, turn off Wi-Fi. Open <https://test-ipv6.com> and see that it has an IPv6 address.
2. In a terminal app (or from a PC on that connection): `nc -6 -vz <the name> <the server's port>`, or open the Minecraft client at the name.
3. Connected means the path works end to end. *Connection refused* means the machine answered and nothing listens (the server is off, or the port is wrong). *Timed out* means a firewall on the way: the
   hosting provider's, if it has one, is the first place to look; `sudo ip6tables -S INPUT` on the node is the second.
4. If it timed out, send the output of `sudo ip6tables -S` and `ss -ltn | grep :<port>` from the node.

## A screen reader

What has been done: axe-core over 29 routes in both themes at three widths finds nothing, and the keyboard paths are walked in Chrome. What has not: a person who uses a screen reader going
through the panel. [Limitations](limitations.md#accessibility) says it; this is what to do about it.

You need: NVDA (free) on Windows with Firefox or Chrome, or VoiceOver on a Mac with Safari, and a running panel.

1. Sign in with the keyboard alone and a screen reader. Is the first thing read the page's name? Does the skip link work?
2. Create a server with the wizard (steps announce themselves; the game choices are radio groups). Is each step's change announced?
3. On a server's page, move through the state pill, the tabs, the console (its reading aloud is off until asked for) and a dialog (focus goes in, and comes back).
4. Open the Audit page and read a row. The rows are CSS grids and are read in order; say whether that is bearable.

What to send back: the screen reader and browser, the step where it went wrong, and what was read.
