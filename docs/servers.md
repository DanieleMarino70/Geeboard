# Game servers

A **game server** is one hosted instance — a Minecraft world, a Terraria map, a
Zomboid save. It belongs to a node and is executed by that node's runtime. It is
not a container; a container is one way of executing it, and one that can be
destroyed and remade without the server ceasing to exist.

## States

```
CREATING → INSTALLING → STARTING → RUNNING ⇄ UNHEALTHY
                                      ↓
                                  STOPPING → STOPPED
                                      ↓
        RESTARTING · UPDATING · BACKING_UP · MIGRATING · DELETING
                                      ↓
                         CRASHED · ERROR · SUSPENDED
```

**Platform-owned** states — `CREATING`, `INSTALLING`, `UPDATING`, `BACKING_UP`,
`MIGRATING`, `DELETING`, `SUSPENDED` — outrank whatever the runtime reports. A server
mid-install is not "stopped" because its workload does not exist yet, and
overwriting that would make a long install look like a failure.

`UNHEALTHY` is a judgement about the game, not the workload: the container is up
and the game is not answering. A running workload does not clear it; only a
health check does.

`CRASHED` is distinct from `STOPPED` on purpose. The agent reads exit codes 0,
130, 137 and 143 as ordinary shutdowns — `docker stop` escalates to SIGKILL
after its grace period, and most game servers run under a shell that never
installs a SIGTERM handler, so treating 137 as a crash would flag every normal
stop. An out-of-memory kill is a crash whatever the exit code, because that is
the one an operator most needs told about.

## Creating one

```
Game → Version → Node → Resources → Configuration → Review → Create
```

What happens on submit, in order, because the order is the design:

1. **Validate** against the game definition — name, host, and resources inside
   that game's own limits. The host is trimmed and lower-cased here, where every
   path that writes one does it: an address is a DNS name, and a DNS name has no
   case.
2. **Check the node** — not draining, not under maintenance, not unreachable.
3. **Check capacity** against committed totals, and refuse with the numbers.
4. **Claim the port block.** The row is written *first*, because inserting it is
   what actually claims the port: a unique index on `(nodeId, port)` turns a lost
   race into a failed insert to retry rather than two servers bound to one
   address. Five attempts, walking the game's stride. A second unique index, on
   the host, does the same for the address: two creates at once on different
   nodes cannot both keep it, and the one that loses is told *Address in use*.
   Both indexes are read by name, because this driver does not say which one lost
   anywhere else — a lost port is tried again, a lost address is not.
5. **Download the build** onto the node if it does not have it, then
   **provision**, with rendered environment and resource limits.
6. **Record** the audit event and the daily backup schedule.

While step 5 runs the wizard shows which of the installer's steps it is on —
prepare, download the build, create it on the node, write its settings, start —
asked once a second of `GET /api/install-progress?key=…` with a key the wizard
made up and sent with the create. A route and not a server action, because Next
runs one client's actions one after another and this one would wait behind the
call it is asking about.

**Downloading is shown as it goes.** The node pulls the image as a job of its
own and counts it from Docker's stream: how many layers there are, from the
start; how many bytes have come, and of how many — which is known only once every
layer has begun, so until then the wizard says "so far" and draws no bar; then,
while the layers are unpacked, how many are done. There is no time limit on it:
the node stops a pull only when it has gone two minutes without moving
(`GEEBOARD_PULL_STALL_MS`), and says where it stopped. A build the node already
has is not a download, and is not shown as one. On this project's own
machine the 2.2 GB download of Zomboid's Build 42 image took about three minutes
and unpacking its 10.4 GB about one more; the node used to give up on the whole
of it after two, and the panel after three.

Anything that fails after step 4 takes the row with it. The rollback asks the
node to remove the whole footprint **by server id**, which reaches both a
workload and a directory — a timeout says nothing about whether the server was
made, so the rollback has to assume it was. A node that does not answer that
either is said to have been asked, not to have done it: the result says
something of the server may be left there, where it used to say nothing was.

**The failure stays in the audit log.** The row goes; a `server.create.failed`
line does not, with the step it failed at, the node's reason and what was left
afterwards, beside the `server.install.*` steps it got through. Those steps used
to go with the row — which is why, when the first create of a large image failed
on this project's machine, nothing was left to say why.

**If the panel itself is stopped in the middle**, nobody is left to roll
anything back: the row says `INSTALLING`, has no workload yet, and nothing writes
it again. The poller reads only servers that have a workload, so until 0.4.1 such a
server stayed "Installing" for ever, with no error and nothing to do about it.
Now a server that has been `CREATING` or `INSTALLING` for ten minutes without its
row being written is one nobody is creating — a live create writes it every second
and a half during a download, and a download whose node stops answering fails on
its own after three minutes — and the poller turns it into an error that says where
the create had got to, that the node may hold part of it, and what to do: delete it
from its Settings page, which asks the node to clear whatever was left by server id
as the rollback does, and create it again. It is never deleted for anybody, and the
audit log has a `server.create.interrupted` line by the Watchdog. An update, a rollback, a rebuild, a
settings rebuild, a restore, a move or a backup stopped the same way is given back too, by whoever
starts next (a panel or a poller that has just started gives back what the last one held; a hung
operation is given back after five minutes without a beat): a backup's server goes back to what it
was, anything else is in ERROR with a sentence, and the page offers a rebuild for ERROR. See
[limitations](limitations.md#interrupted-operations).

A node with no agent attached produces a real row and a simulated server, and
the result says so rather than pretending. A simulated server carries a
`simulated` badge on the servers list and its own page, with a banner saying
nothing is running; its start, stop and restart report as warnings, never as
successes, and are recorded as `started (simulated)` and so on. The simulator
settles only servers with no workload on a node with no agent — it once settled
any server stuck in `STARTING` or `STOPPING`, which let a page render declare a
real server whose start had failed `RUNNING`.

## Templates, and cloning

A template is a way to start. Every game comes with a few of its own in the
create wizard — Classic, Expert, Journey — and any of them can be changed at the
review step, or later on the Settings page.

**Your own.** On a server's Settings page, *Reuse this server* keeps its settings,
its limits and its version under a name you choose. The **Templates** page, under
Catalog, lists them; *Create a server* on one opens the wizard on that game and
version with those values, and the review step says *Saved template* and which. It
is for owners and admins, as creating a server is.

What a template keeps is the settings of the server, its memory, CPU and disk, and
the version it was on. What it leaves behind is everything that belongs to that
one server: the world, the players, the address and port, the node, the schedule —
and two kinds of setting. A join password is not kept, because a template is read
by anybody who may create a server and a password written into it would sit in a
row many accounts can see; a server made from it asks for its own. A setting that
names a file in the server's own folder — Terraria's world file — is not kept
either, since it points at a world on one machine's disk. The page that saves a
template says which of the game's settings it left behind.

A template does not hold on to anything it was made from. Deleting one leaves the
servers made from it exactly as they are, and a template saved on a version the
game has since dropped starts on the game's default and says so.

**Cloning.** *Clone* on the same card opens the wizard filled in from that server:
its game, version, settings (the world file included, without the password) and
limits, with the name *… copy*. Nothing else about the source changes. The review
step offers **Copy the world too** when an off-site bucket is set up: the panel
takes a backup of the source into the bucket and puts it into the new server, so a
world travels the way it already does between servers, and not by the panel moving
folders between machines. The source keeps running while its backup is taken. With
no bucket the box says why it is off, and the copy gets the settings and a new
world.

A clone is two steps and not one: the server is created, and then its world is put
in. If the second fails — the bucket is down, the node is — the new server is
still there, running on the world it was created with, and the message names what
went wrong; nothing is deleted. The audit log has *template.saved*,
*template.deleted* and *server.cloned* (copied or not), and a server made from
either says in its creation line what it was made from.

Not in a template: mods. A server's mods are a list the panel keeps for it and
applies through the node, and a clone with its world carries the files, so the
copy runs with them, but its Mods tab starts empty.

## Stopping

A stop writes the game's `stopCommand` to its console — `exit` for Terraria,
`stop` for Minecraft — and waits up to the grace period for the process to leave
on its own. Only then is it signalled, with ten more seconds before the kill.

A signal alone was the old way, and for most images it meant thirty seconds of
nothing: the game runs under a shell that ignores SIGTERM, so `docker stop` waited
out its grace and killed it. Measured on Terraria: exit 137, world unsaved. Asked
with `exit`, it saves and is gone in about three seconds.

Restart is a graceful stop and a start, for a game with a stop command. Restoring
a backup and rolling back an update stop the same way. The server is `STOPPING`
while it happens, so a poll landing mid-shutdown is not reported as drift.

## Addressing

`RuntimeRef` is `{ serverId, runtimeId }`, and both halves matter.

- `serverId` names the data directory, survives a workload being destroyed and
  remade, and is what file operations use — which is what makes it possible to
  read a crashed server's logs and fix its config.
- `runtimeId` is whatever the runtime currently calls the thing it is running.
  Null until one exists.

## Console

Commands go to the game's **stdin**, not to a new process. A game server reads
its console from stdin; `docker exec` would start a second process the server
never sees. Multi-line input is rejected so a second command cannot be smuggled
in.

Output reaches the browser as Server-Sent Events proxied by the panel — the
browser never connects to a node, and the node token never leaves the server.
Commands go the other way over a normal server action.

Watching and typing are separate permissions. A moderator can watch any server's
console and type only into their own. A member watches and types into their own
server's console only: on anybody else's, the console page says **No console
access** and the overview says who its last lines are open to, rather than
showing them. A console left open is asked again every ten seconds, and closes
with the reason — *Your role is now member*, *You were signed out* — instead of
going on showing what its reader may no longer see. See
[security.md](security.md#console-safety). A console is the game's; a shell of
the node's machine is the [node terminal](nodes.md#node-terminal), under
Infrastructure, and a different door.

The suggestions under the input are the game's own `console.examples`. The server
overview shows the last six lines the node returned when the page was drawn —
labelled as such, not as live — or says why there are none: no agent, no
workload yet, or the node did not answer within two and a half seconds. It used to
show a fixture Minecraft log with a pulsing "live" dot on every server.

**Each line carries the time Docker wrote it down**, and is shown in the
reader's own clock; a downloaded log says which clock in its first line —
`# World Lab console, 2026-09-26 03:17:20 (UTC+02:00)` — and dates every line.
Until 0.3.1 a line was stamped when it reached the browser, so every reload
gave the whole backlog the time of the reload, and a log downloaded in Italy
read two hours behind the clock on the wall.

**A line is shown once.** The page is drawn with the node's recent lines and
the stream then sends its own; a line with the same time, to the nanosecond,
and the same text is the same line. A downloaded file used to carry a hundred
lines twice. **A restart goes on in the same console**: the node follows the
next run from the last line it sent, where it used to go quiet at the first
stop until the page was reloaded.

**Progress is folded.** A run of lines that differ only in their numbers —
Terraria's *Resetting game objects 1%* to *100%*, and every stage of making a
world — is shown as its last line, each kind once, so a boot is a dozen lines
instead of hundreds and its error is not pushed off the page. The page reads
the last thousand lines, and the overview's six are taken from as many. Making
a new Terraria world prints tens of thousands; the start of that run is past
any window, and the error at its end is not.

**What Geeboard asked is marked as Geeboard's.** A game's definition can name
the lines it prints because of a health check (`console.healthLines`). For
Terraria that is *172.17.0.1:47914 is connecting…* and *…was booted: You are not
using the same version as this server.* every five minutes — the node itself,
from Docker's bridge, asking in a version no player has. Those lines are dimmed
and tagged **Geeboard health check**; a connection from anywhere else is not.

The full console page still shows that fixture for a server on a node with no
agent, labelled as simulated. A server on a real node with no workload gets a
sentence saying so and a link to its page, not the fixture.

## Files

Confined to `<dataRoot>/<serverId>` on the node: a lexical check catches `../`,
and a symlink pointing out of the tree, which no amount of string handling would
see, is refused too (on Linux the agent walks the path through open directories,
so a game cannot swap a directory for a link while a file is being written). The server root cannot be
deleted, and a file over 2 MB is reported rather than streamed into a browser
textarea.

**Files go in and out from the page.** Upload takes the toolbar button or a
drop onto the listing, one file at a time, up to 256 MB each — a name already
in the folder asks before it is written over, and the node writes beside the
target and renames, so an upload that drops halfway leaves the old file in
place. Every upload is an audit entry with its size. Download is the arrow on
a file's row, streamed from the node through the panel. A folder is not
uploaded: make it here and drop the files into it.

**What arrives is counted.** The browser says how big the file is, and the node
refuses one that comes to less, before it replaces anything: *the upload ended
at 10485760 of 11932207 bytes, so nothing was written*. Up to 0.3.0 the panel
itself cut every upload at 10 MB — Next.js's proxy holds a copy of each request
body and stops at that size without saying so — and the file was kept, and
called uploaded. A Terraria world of 11.4 MB went on the node as 10.0 MB and
failed to load days later. Hover a size for the exact number of bytes.

**A file a game can use has the button for it.** A game's definition may say a
setting names a file in the server's own folder (`fromFiles`); Terraria's world
does. Such a file at the root of the folder gets **Use as world** on its row, or
*in use* if it is the one; the button sets the setting, as the Settings page
would, and says the server opens it on its next start. It is there for people
who may change the server's settings.

Reading and writing are separate permissions, and neither comes with console
access.

## Health

Every poll pass asks the game's own probes whether it is answering. The probes
come from the definition; the node provides one primitive — a TCP connect to a
port that server publishes — and the judgement happens in the domain.

```
healthy     every probe that ran, passed
unhealthy   a probe failed, and the boot grace has expired
booting     inside the boot grace — not yet news
unknown     nothing could be checked, which is not the same as healthy
```

The distinctions carry weight. A node that did not answer a probe is not
evidence of a broken game server. Console output that has rotated past a
server's startup line is not a failed check: the poller records `readyAt` the
first time the ready line appears in a run, and the log probe passes from that
record until the server restarts. A server inside its boot grace —
900 seconds for Zomboid, 1200 for Rust, because both build a map on first
boot — is not broken, and restarting it would break something that was working.

A **crash line outranks a passing probe**: a process that has printed
`java.lang.OutOfMemoryError` is not healthy because its socket is still open.

**A known failure says what it is.** A definition can name lines that mean the
server cannot do its job, each with the sentence to show (`health.failures`).
Terraria has two: *Load failed!*, a world file it could not read to the end, and
*Failed to create the file*, a world it cannot save. A running server that has
printed one is `UNHEALTHY` at once, inside its boot grace too, and its page says
the sentence rather than *a probe failed*. A server that stopped after printing
one is **Stopped** with that sentence on its page, and the audit event for the
stop carries it as its `Reason`. Both came from a production server: a world
that failed to load, and a process that exited with code 0 — which the panel
reported as *Stopped* and nothing else — and a server that ran for hours
building on a world it could not save, reported as *Running*.

**A `query` probe asks the game in its own protocol.** The node's second
primitive is one exchange: these bytes to a port this server publishes, and
whatever came back. It was refused for a long time, because an endpoint that
writes bytes to a port on request is a port scanner with an HTTP interface, and
the alternative — teaching the node Minecraft's handshake — puts game knowledge
in the one place it must not go. What makes it acceptable is what it cannot do:

- the port has to be one the server's own workload publishes, on the transport
  it publishes it on — the rule the connect probe has, one notch tighter
- one payload of at most a kilobyte, a reply cut at four, five seconds
- the only caller is the panel, which can already type into that game's
  console and write any file it reads
- it knows nothing. Which bytes are a Minecraft status request, and whether the
  reply is one, is decided in
  [`domain/servers/query.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/servers/query.ts), as plain
  data in and out, tested with no socket

An answer is judged on its shape alone — a framed status packet, a Source
header, a Terraria packet of a kind a server sends — because a health check
wants to know the game's network loop replied, not what it said.

| Protocol | Asked of | Measured |
| --- | --- | --- |
| `minecraft-ping` | Minecraft: Java Edition | Paper 1.21.4, 26.2, 26.3 answer; nothing is logged; a frozen server is "took a query and did not answer it" |
| `terraria-hello` | Terraria | Vanilla 1.4.5.8, 1.4.4.9, 1.4.3.6 and TShock 5.2.4 answer their own connect request with a disconnect and survive it. Two console lines per question, so it is asked every five minutes (`everySeconds`) |
| `source-a2s` | Valheim | Answers only while listed publicly **and** with crossplay off; otherwise the port is bound and silent. So the probe carries a `when`, and is reported as *not asked* for every other server |

A protocol is declared only after its bytes have been put to the real image —
`npx tsx scripts/probe-query.mts terraria-hello <port>` — because the wrong
bytes can crash a game. Vanilla Terraria 1.4.5.8 dies when a connection goes
away before it has finished accepting it, which is how the connect probe
crash-looped it; the exchange therefore never hangs up first while an answer
may still come. A good answer stands for `everySeconds`; a bad one is asked
again on every pass, so a server is heard coming back at once.

`rcon` probes are still **declared and skipped**: they need a password the panel
does not hold, and no game offered declares one. `terraria-rest` is named by the
type and not spoken.

An `UNHEALTHY` server is held in that state against the runtime's view — a
running workload does not make a game healthy — but it still gets its health
check, which is the only thing that can clear it. Until the release work it did
not: held like a server mid-update, it was skipped whole, and a server that
failed one check stayed `UNHEALTHY` however well it answered afterwards. Found
on a real Terraria server, the first time a query misjudged a reply.

## Settings

The Settings page holds two forms, and they answer different questions.

The **platform's** form is the panel's own record of a server: its name, the
address players are given, its memory and CPU ceilings, and what happens when it
stops unexpectedly. Nothing else: the form used to carry a MOTD, Java flags,
autosave and a whitelist toggle, which were written to the server row and read
by nothing — the game never saw them, while its own form, two cards below, held
the real MOTD and the real whitelist. Anything a game reads belongs to the game's
form, which is generated from its definition.

Memory and CPU are checked against the game's own limits and against what the
node has left after everything else placed on it, and both are ceilings fixed
when the workload is made — so changing one says, on the spot, that it takes a
rebuild.

The **game's** form is the one below. It shows what the server has, not what the
panel remembers: before it is drawn, the files its settings live in are read from
the node, and where a file disagrees with the stored value the file wins and the
form says which settings changed and to what. Somebody editing `serverconfig.txt`
from the Files page, or a game that rewrites its own config on boot, used to be
invisible here — and the next save put the panel's older value back without
saying so. A node that cannot be reached, or a file that does not exist yet,
falls back to the stored settings.

**The page is open to every account; changing a server's settings is not.**
Somebody who may not change them — a member or a moderator, on a server that is
not theirs — sees the game's form without a Save button, and a join password as
*Hidden*: it is given, from the panel or from the server's files, only to whoever
may change it, and a change to it is written into the audit log as a change,
never as its value. Until 0.3.2 the form looked editable to everybody and carried
the password in every page it was drawn on.

Only file-backed settings can be read this way. An environment variable belongs
to the workload and has no file to look at.

Its settings are of two kinds, and the difference is not a detail:

| | Written to | Applies |
| --- | --- | --- |
| A config file | `serverconfig.txt`, `servertest.ini` | Immediately, or at the next restart |
| An environment variable | The workload itself | Only when the workload is rebuilt |

The environment is fixed when a workload is created. Saving an environment
change and leaving the server running the old value would be worse than
refusing — so `planConfigChange` works out which each change is, the form shows
it, and a rebuild is a second, deliberate act.

A rebuild destroys the workload with `withData: false` and installs a new one
around the same data directory. The world, its files and its address are kept;
players are disconnected while it happens. The state is `UPDATING` throughout,
which is platform-owned, so reconciliation will not see a server with no
workload and decide it has stopped.

The row's `runtimeId` is cleared the moment the old workload is destroyed. A row
still naming the destroyed workload would be found missing by the next poll and
reported as removed outside the panel, over the real reason.

**If the new workload cannot be made, the old settings come back.** A settings
rebuild goes through the same rebuild an update does (`rebuildWorkload`), and
has the same way back: the workload is made again from the settings the server
had, which are known to start, and the stored settings go back with it — a form
showing values the server is not running on would be the panel saying something
it knows to be false. The refusal names the reason and says it was put back;
`server.config.failed` in the audit log records the change, the reason and the
outcome. Only if that fails too is the server `ERROR`, with its world intact and
a Rebuild button. A stopped server stays stopped. No backup is involved: the
world is not touched.

What this catches is a workload the node will not make or start — a port taken,
a build that will not pull, a value the node refuses. A game that starts and
then exits on a setting it dislikes is a crash, and crash recovery's business.

This used to be a copy of the rebuild with no way back, which left the server
in `ERROR` with a Rebuild button that failed the same way until somebody worked
out which setting to undo.

## DNS

A server's address is a hostname, chosen when it is created and changed on its
Settings page. Who keeps the record behind it depends on one thing: whether a
**DNS provider** is configured on the DNS page, under Infrastructure.

**Without one, nothing is different from before 0.4.0.** The wizard proposes
`<name>.<the domain your other servers use>`, the page shows `host:port`, and
pointing the record at the node is yours to do. No provider is called, nothing
is written, and the address field's hint says so.

**With one**, the panel keeps the record for every server whose address is
under the provider's zone — a Cloudflare zone's name, `duckdns.org`, or the
domain a [webhook's](dns-webhook.md) receiver writes in — and
says on the server's page and on the DNS page how it stands:

| | |
| --- | --- |
| *written* | The record says the node's address. `points at 203.0.113.9` on the server's page. With a webhook it is *accepted*: the receiver said it will act, and the panel cannot look at the DNS to see that it did |
| *not written* | The provider refused or could not be asked, and why. The poller tries again every five minutes; **Retry now** on the DNS page tries at once. With a webhook, *not taken* |
| *no address* | The node has no public address to point at — see below |
| *outside the zone* | The address is not under the provider's zone, so the record is yours, as without a provider |

**Up to three records for a server (0.7.0).** An **A** record points the address at the node's
IPv4 address. An **AAAA** record points it at the node's IPv6 address, when the node has one set —
see below. And for a game whose clients look one up, an **SRV** record says which port the game is on.
Minecraft: Java Edition's client does: given a name and no port, it asks DNS for
`_minecraft._tcp.<name>` and connects wherever that points. The panel writes
`_minecraft._tcp.<address>` as `0 5 <port> <address>`, with the port of the block the server holds, so
players type the name and nothing else — the second server on a node, which holds 25568 and not 25565,
and a server that moves to another node and another port, keep one address. The server's page then shows
the name without a port, and *found by SRV* beside the port that the record carries. Three things limit it:

- **Only where the provider can hold one: Cloudflare, and a webhook.** DuckDNS holds one IPv4 and one IPv6
  address for a subdomain and nothing else, so there a Java server's address is `name:port`, as before, and
  the page says so. A webhook is sent the SRV like any other record, and its receiver decides: one that
  keeps none answers `422`, and the page then does not say players need only the name.
- **Only Minecraft: Java Edition.** Bedrock's client does not look an SRV record up, and its game is UDP. A
  game declares it in its definition (`srv`); a community game's manifest cannot, in this release, since
  it would write a record into the owner's own zone.
- **Only when there is an address for it to name.** An SRV record whose target has no address points at
  nothing, so a server on a node with no public address has none.

The panel does not make these records appear to work: the SRV is *written*, and what the Java client does
with it is Minecraft's. It was checked here against a stand-in Cloudflare and the real panel, and with a
real Cloudflare for the shape of the request — see the roadmap — not with a Minecraft client.

**The wizard checks the address as it is typed.** Under *Name and address* the
panel asks the DNS, a moment after the last keystroke, whether the name exists and
where it points, and says what that comes to for this workspace: already at one of
your nodes; a name that does not exist yet, which Geeboard will write if it is under
the provider's zone; one that points at a machine that is not a node; one outside the
zone, which is yours to make; or, with a provider set, that no node has a public
address to point a record at. With **no provider**, a name that does not exist or
points elsewhere also gets a short offer to set one up — *Want a name of your own?* —
with a button that opens the DNS page in a new tab, so the draft stays, and *Check
again* for when you are back. A lookup that could not be made is said, and never
stops the server being created. The check is only for whoever may create a server,
and asks about nothing but a well-formed name.

**Setting it up** is the DNS page: choose the provider and the steps beside the
form are that provider's — where the token is, what to make there, what to paste
here, and what to do to a server — each ticked from what the panel holds. Below
the provider are four counts (written, waiting for a node's address, needing
attention, yours) and every server's record, with **Retry now** on each. The
panel makes the record for a server itself with Cloudflare and DuckDNS, and sends it
to a receiver with a webhook, but does not make the
DuckDNS *subdomain* that holds it: DuckDNS's API has one call to update a record
and one to update a text record, and none to make, list or remove a subdomain, so
that is made on duckdns.org, once per node (below). A server whose subdomain is
not in the account says so beside a button that copies its name. Cloudflare needs
nothing made first.

What the panel does, and when:

- **Created**: the record is written as the server is created, pointed at the
  node it was placed on. A record the provider will not write is never a reason
  the server is not created: the toast says so, the failure is kept on the
  server, and the poller keeps trying.
- **Moved**: the records follow the server to the new node's address, and the SRV record carries the
  new port, which a move can change. The name stays; what a player typed still works.
- **The node's address changes**: every record on the node follows it, within
  a poll — this is what a home connection with a changing address needs, and
  why DuckDNS is supported at all.
- **The address changes** on the Settings page: the old name's record is
  removed and the new name's written. A new address outside the zone loses its
  record and gets none.
- **Deleted**: the record goes with the server. A record that will not go does
  not keep the server; the audit log names it as `server.dns.orphaned`, so
  somebody removes it at the provider.
- **Configured after servers exist**: every server whose address is under the
  zone gets its record within a poll, as if created after.

**Where a node's address comes from.** A record points at an IP address, and
the panel needs to know the node's. Two sources, in this order: the **public
address** a person set with *Configure* on the node's page — an IPv4 address in
*Public address* and, if the machine has one the Internet can reach, an IPv6 address in
*Public IPv6 address* — and, failing both, the address the panel **observed** the
node's last heartbeat coming from. What a person set is the whole answer: with either
set, the observed address is not looked at, so **the panel never writes a record the
operator did not ask for** — in particular no AAAA for an IPv6 address it happened to see,
which may not be one the Internet can reach, and which would send a player who prefers
IPv6 to a server that is not there. An observed address is used only when it is public:
from the same LAN the panel sees the node at `192.168.1.20`, which no record should say,
and the node's page says so and asks for one to be set. Behind a proxy the panel reads the
peer from `X-Forwarded-For` as its own Caddy writes it; without a proxy in
front, as in development, nothing is observed and the address has to be set.

**A record that is already there** (Cloudflare, which can list records; DuckDNS and a webhook cannot, and write without asking):

| At the name | The panel |
| --- | --- |
| nothing | creates the record: an `A`, `AAAA` or `SRV`, with a 60-second TTL and the comment `geeboard:<server id>` that marks it as the panel's — unproxied, for the address kinds; an SRV has no proxy |
| a record with the same address (or, for an SRV, the same numbers and target) | adopts it: writes the marker onto it, and keeps it from then on — `already pointed at …` in the toast |
| a record with the marker and another address or port | updates it |
| a record without the marker and another address, a `CNAME`, or more than one record of the kind | leaves it alone and says so: a record that pointed somewhere on purpose is not overwritten because a server took the name. Change the server's address, or remove the record at Cloudflare and press **Retry now** |

Each kind is decided on its own: an `A` and an `AAAA` at one name are not in each other's way, which until
0.7.0 was refused as *two records*. A foreign SRV record at the server's SRV name fails that record alone — the
`A` is still written — and the server's page does not claim players need only the name until the SRV is.

**How long it takes.** A record written at Cloudflare is answered by its
nameservers within a few seconds — measured between 5 and 20 — and by public
resolvers as their cache of it expires: its TTL is 60 seconds, so a moved record
can show the old address for up to a minute at one resolver and the new one at
another. One thing works against a test: a resolver that was asked for a name
*before* its record existed caches the absence for the zone's negative TTL, which
on a Cloudflare zone's SOA is 30 minutes. Look a new name up after the panel has
written it, not before.

**DuckDNS: one subdomain per node, and a name for every server under it.**
DuckDNS has no records to list and none to create: a subdomain is made on
duckdns.org, and the panel points it. But DuckDNS answers for every name
under a subdomain of your account with that subdomain's address —
`aurora.myserver.duckdns.org` and `a.b.myserver.duckdns.org` resolve as
`myserver.duckdns.org` does — so a server needs no subdomain of its own. Make one
per node, once; the wizard proposes `<name>.<that subdomain>.duckdns.org`, and the
record is written through the subdomain:

- **Servers on one node share it.** The first writes the address; the others
  agree without asking DuckDNS, which asks not to be updated for nothing. Renaming
  within the subdomain touches nothing.
- **A server on another node is told, not obeyed.** A subdomain has one address,
  so while a server on `ash-node-01` holds `myserver`, a server on `fra-node-02`
  under it is saved and shown *not written*, with the reason: it needs a subdomain
  of its own. The one that holds it is the one with a record written; the other is
  tried again every five minutes, and takes it over when the first is gone.
- **The last one clears it.** Deleting a server that shares its subdomain leaves
  the address where it is, and says who still uses it; the last to go clears it.
- **Two families, no SRV.** A subdomain holds an IPv4 and an IPv6 address, each written through its
  own parameter. DuckDNS can clear a subdomain and cannot clear one family of it, so when a node's IPv6
  address is taken away the subdomain is cleared and the IPv4 address written back.

An address that is not under a subdomain of the account, or a wrong token, is `KO`
from DuckDNS and *not written* here — make the subdomain (the row says which),
then **Retry now** on the DNS page, or change the server's address on its Settings
page. How many subdomains an account may have is DuckDNS's to say. The token
check writes one of the account's subdomains back as it is; a subdomain with no
record yet is cleared, which changes nothing.

**A webhook: any other DNS, through a receiver you run.** For BIND, Knot, PowerDNS, a router, or a host
with an API of its own, the panel does not write the records: it tells a small receiver what to set and
what to remove, signed, and the receiver does it. Setting it up is the DNS page — *Make one* for the
signing secret, give it to the receiver, then the address and the zone, saved only if the receiver
answers a signed test — and [A DNS webhook](dns-webhook.md) is the receiver's page: the requests, the
statuses and what the panel makes of each, and a receiver that runs `nsupdate`. Four things differ
from the other two, and are said where they show:

- **Accepted, not written.** A `2xx` is the receiver saying it will act. The panel cannot read your DNS.
- **No reading.** It cannot ask what is at a name, so it cannot tell a record somebody else made from its
  own and cannot refuse to overwrite one: that is the receiver's, which is sent the marker
  `geeboard:<server id>`. A record removed by hand is not noticed either.
- **What changed, not everything.** A node that moved sends the `A`; a server that took another port sends
  the `SRV`. **Retry now** sends every record again.
- **A receiver that is down is waited for once.** Creating, moving and deleting a server wait for the
  call, with a five-second timeout; the poller waits once in a pass, leaves the rest, and does not ask
  again for five minutes.

**What is recorded.** `dns.configured`, `dns.checked` and `dns.removed` for the
provider, `server.dns.set`, `.adopted`, `.updated`, `.removed`, `.refused`,
`.failed` and `.orphaned` for records, each with what it was about: the name and what the
record says, and a change line of its own for *Address*, *IPv6 address* or *SRV*.
Never the token, which is stored encrypted, checked against the provider before
it is saved, and not shown again — see
[security.md](security.md#dns-provider).

## Mods

**Project Zomboid, and only Project Zomboid for now.** A server's **Mods** tab
is where Workshop items are chosen; a game whose definition says nothing about
mods has the tab greyed out rather than an empty shelf behind it.

The panel never downloads a mod. It writes two keys into the game's own
settings file and the game fetches what they name, on the node, from Steam:

| | |
| --- | --- |
| `WorkshopItems` | what to download — Workshop ids, numbers |
| `Mods` | what to load — mod ids, names, which live inside the downloads |

Those are two different lists on purpose. One Workshop item can carry several
mods, and the name the game loads a mod by is written in a `mod.info` inside
the download — which nothing outside the node can know. So the sequence has a
shape, and the tab says which step it is on:

```
chosen        a row in the panel; the game has not been told
applied       the ids are in the game's settings
downloaded    the game fetched them; the node says what is inside
loaded        those mod ids are in the load list, and the world runs them
```

**Which build a mod is for.** Build 42 keeps a mod's files in a folder per game
version — `42/`, `42.0/` — beside a `common/` folder, and reads the highest one
not above its own version; Build 41 reads a single `mod.info` at the top of the
mod, and neither reads the other's layout. A `mod.info` can also say which
versions it runs on. A build that cannot see a mod does not stop over it: it
logs "not found" and starts without it, and nothing else would say so. So once
the node has the download, the panel judges each mod against the server's own
version the way the game does, puts into `Mods` only what that build loads, and
says on the row why the rest will not load — *laid out for an older build*,
*needs 42.21 or later*. The same goes for what a mod requires: a `mod.info`'s
`require=` names other mods, and one whose requirement the server does not have
is not loaded by the game — nor is anything that requires it — so the row says
*needs Erikas_Tiles* and the mod stays out of the load list. A requirement the
server has is loaded by the game whether it is listed or not, so a mod switched
off that another one needs is loaded anyway, and its row says that too. Before
the download, the Workshop's tags are the only
word on it: a collection's preview counts them — *5 for Build 42, 1 for Build 41
only* — and a mod tagged only for the other build is added with a warning. Tags
are written by the mod's author and are sometimes wrong, so they never refuse
anything; the files decide.

**Apply waits for the game to have started.** A Zomboid start that downloads
mods writes the game's settings file again once they are in, from what it read
as it started — measured on 41.78.19 — so a list written in between would be
lost, and in between is exactly when **Ask the node** first sees the files. While
the console has not said *SERVER STARTED* since the server last started, Apply
says so and writes nothing.

**Apply to server** writes the list and takes a backup first — a mod is the one
change that can break a world rather than a workload. The game reads the list on
its next start, and fetching a large mod can take minutes; **Ask the node** is
what fills in the mod ids once it has. A mod switched off stays downloaded, so
turning it back on costs nothing. Removing one takes it out of both lists; what
it already put into a world stays in that world, which is what the backup is
for.

**Collections.** Paste a Workshop *collection's* link into the same box and the
tab shows what is in it before anything is added: how many mods, how many this
server already has, and what was left out — items Steam no longer has, items
for another game, linked collections that are gone. **Add** puts the new ones
after everything the server already has, in the collection's own order, so its
author's load order holds among them; a mod the server already has keeps its
place, its on-or-off and its mod ids. A collection that links other collections
is followed, and each linked collection's items go where the link sits. Each
item is added once, a pair of collections that link each other is walked once,
and past 1,000 items or 50 collections the panel stops and says so. A
collection is not something the game can download — it is a list — so what
reaches the node is the items, exactly as if they had been added one by one.

**A collection leaves as it came.** Every mod a collection adds remembers it:
its row says *from Rawt Building Craft*, and above the list each collection has
a line with how many mods it added and **Remove its mods**, which asks once and
then takes those — and only those — off the list. A mod of that collection that
was added on its own before it, or that another collection brought, stays,
because it was chosen some other way. Applying the list is what takes them off
the server, as for one mod. Mods added before the panel remembered collections
have none; pasting their collection again counts the ones already there as its
own without moving them, and the button says so when there is nothing new to
add.

**What a mod needs from the Workshop**, with a Steam Web API key: when a mod is
added, and whenever the node is asked, the panel asks Steam what its Workshop
page lists as required, and a row whose requirement is not on the list says so
and offers to add it. That is the item the game will need, named before it
fails to find it. Without a key it is not known — Steam answers it through the
keyed API only — and the node's own check still names a missing mod once the
game has the files, by its mod id rather than by the item that carries it.

**Browsing needs a Steam Web API key**, because Steam offers search through the
keyed API only. Make one at
[steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey); the
domain that form asks for is a label Steam neither checks nor enforces, so the
panel's address will do. It belongs to a Steam account, so treat it as a
secret. Set it either way:

- **On the Mods tab**, as an owner or admin. The panel asks Steam before it
  keeps the key, stores it encrypted like the bucket's secret, and never shows
  it again — the tab says who set it, when, and whether Steam last accepted
  it. A key Steam starts refusing is marked on the tab the next time somebody
  searches.
- **As `STEAM_API_KEY`** in `deploy/panel/.env` (or `web/.env` in development),
  which `deploy/panel/init.sh` writes the empty line for. **This one wins**:
  while it is set, the tab says the key comes from the environment and offers
  nothing to save, since a saved key would not be the one used. To manage the
  key from the tab instead, empty the line and restart the panel.

Without a key the tab still works for anything with a link: paste the URL or id
of an item or a collection and the panel asks Steam about it — those endpoints
need no key at all. Neither the search nor the pictures are stored by the
panel; with the network gone, the list a server already has is still there and
still applies.

## Reconciliation

A server can crash at 3am, or be stopped by hand on the node. Neither goes
through the panel. `npm run poll` asks every reachable node what is actually
true, every fifteen seconds:

- Platform-owned states are held, and counted as `held` in the report
- Drift becomes an activity event — `server.crashed`, `server.recovered`,
  `server.stopped.unexpectedly`
- Transitions the panel asked for are not news
- A running server gets a metric sample written while we are there
- A workload the node no longer has — `docker rm`, a Docker reset — is said
  once: the server goes `ERROR`, its `runtimeId` is cleared, `lastError` says it
  was removed outside the panel, and `server.workload.missing` lands in the
  activity log. Counted as `workload gone`, not as an error line on every pass,
  which is what it used to be. A server mid-update is held, since its workload
  is meant to be missing for a moment

Containers are created with `RestartPolicy: no` deliberately. Docker restarting
one behind the panel's back is precisely the drift this exists to catch, and
restart-after-crash is a policy the panel applies, where it can be audited.

## Crash recovery

Each server has a policy and a ceiling:

| | |
| --- | --- |
| `NEVER` | Leave it down |
| `ON_FAILURE` | Restart after a crash. A clean exit nobody asked for is not one |
| `ALWAYS` | Restart whenever it stops, a crash or not, and after the machine did |

Restarting is the easy half. Not restarting forever is the half that matters — a
server that crashes on boot will crash on boot again, and a policy with no
ceiling turns one broken world into a machine spending all night starting and
killing the same process. Three things prevent it:

- **A ceiling.** Past `maxRestarts` the server goes to `ERROR` with the reason,
  rather than being retried quietly. A dashboard showing a server that has given
  up reads differently from one showing a crash being handled.
- **Growing delays.** The first restart is immediate, because the common crash
  is a one-off and making somebody wait for that is worse service for no safety.
  Then 30 seconds, 2 minutes, 5 minutes.
- **A stable window.** Attempts are forgiven only once the *current* run has
  lasted — the count has to mean "crashing now", not "has ever crashed". The
  window scales with the game's boot grace, because forgiving a Rust server at
  ten minutes would reset its budget while it was still generating its map.

**An out-of-memory kill is never retried.** The server asked for more than it was
given, and starting it again produces the same kill on a loop until somebody
raises the limit. It gives up and says which limit.

Every outcome lands in the activity log, including the decision not to restart.

### After the machine restarts

A reboot, a power cut that comes back, or a restart of Docker stops every container on
the machine, and the agent reads that stop as an ordinary stop on purpose: a game that
is killed by its grace period because it never handled the signal did not crash. So
for a long time a server whose policy said "restart whenever it stops" stayed stopped
after a reboot, with nothing on its page saying why.

The panel now tells a stop it asked for from one it did not by what it wrote down
first. A stop, a restart, an update and a typed `stop` at the console all set the
server's state before they act; a server that goes from running to stopped with none
of them is somebody else's doing: the machine, Docker, a `docker stop` on the node, a
command typed inside the game, or the game quitting. Then:

| Policy | A stop nobody asked for |
| --- | --- |
| `ALWAYS` | Started again. With evidence that the machine did it (below) at once, and without using up the budget: two reboots in an afternoon are not a crash loop. With none, under the same ceiling and the same growing delays as a crash, because a game that stops the moment it starts is no better for having exited 0: it gives up after `maxRestarts` too, and says so |
| `ON_FAILURE` | Left stopped. The server's page says why it is down and what to do, and the activity log gets `server.left.stopped`, which is the notification |
| `NEVER` | Left stopped, said the same way |

**What it says about why is what there is evidence for.** Measured on a real machine, a
Minecraft server that Docker stops with SIGTERM exits with code 0, the same code as the
game quitting by itself, so the exit code cannot name the machine. The page says one of
three things:

- *Docker or the machine stopped it* — only when a signal ended the game (exit code 143,
  137 or 130), which is what a restart of either does to a game that does not handle
  the signal.
- *It stopped together with N other servers on the node, which points at the machine or
  Docker restarting* — when more than one server of that node was found stopped in the
  same pass. A restart of the machine ends everything on it at once; one game quitting
  does not. This says "points at", and not "was", because it is evidence and not proof.
- *The panel did not stop it and nothing says why* — a lone stop with a clean exit: the
  game may have quit by itself or been stopped from inside it or on the node, or the
  machine may have restarted, and the panel does not choose. A server that stopped
  because its game said why (a world that would not load) says that instead.

A server alone on its node that a reboot stopped is in the last case: there is nothing on
the panel's side to tell it from the game quitting, and it says so.

The panel does the starting, from the poller, which is why the node has to be reachable
and the poller running; both come back by themselves after a reboot (`restart:
unless-stopped` in the compose file, and the `systemd` unit for the agent). When the
machine that was rebooted is the panel's own, the servers on it are started again by
the first passes after the poller does. A hard power loss is different in one way: Docker
marks containers that were running as having exited with 255, which the agent reports as
a crash, so `ON_FAILURE` servers are started again too, by the crash path above.

**`ERROR` holds.** A server the panel gave up on stays `ERROR` for as long as its
workload is down. Reconciliation used to read the dead container back as
`CRASHED`, which sent it through recovery again, which gave up again — two
activity events every poll, found on a real node after fourteen of them. Only the
server coming back up, by hand or by a start from the panel, clears it.

## Schedules

`runDueTasks` runs inside the poller process, every pass. Backups, restarts,
broadcasts, commands, cleanups and archive verification all do their work; a
broadcast uses the game's own wording from its definition, and a verification is
described in [backups.md](backups.md#verifying-what-is-sitting-there).

A task more than fifteen minutes late is **skipped and rescheduled** rather than
run. Catching up matters for some jobs and is actively wrong for others: a panel
that was down overnight should not wake up and fire six hours of restarts in a
row.

Scheduled runs are attributed to a `Scheduler` system account rather than to
whoever created the task — they did not press anything at 03:00, and an audit
log that says they did is one nobody can trust.

## Updating

```
download    the new build onto the node, while the server keeps running
back up     locked, so retention cannot take the way back
stop        a world half-written by an update is not a world
rebuild     destroy the workload, keep the data, install the new version
start
record      what it was on, so going back is a button
```

The download comes first, and the page shows how far it has got the way the
create wizard does. It used to happen inside the rebuild, after the server was
stopped — minutes of downtime for a large build — and a download that fails now
fails before anything has been backed up, stopped or destroyed.

The stop is the game's own command, as for a rollback and a rebuild. An update
used to leave it to the rebuild, which removes the old workload by force: the
game was killed where it stood, a moment after the backup had saved it.

The backup is not optional. Never blindly overwrite a working server —
and it is **locked**, so a cleanup task sweeping old archives is not the
thing that quietly decides whether a rollback is still possible.

The world survives because the workload is destroyed with
`withData: false`. A server's files live in the volume, not in the
workload, which is what makes swapping the thing that runs them safe.
Settings survive too: they are stored on the server row and re-rendered
against the new version, so an update is not a reset.

**What is not an update** is refused before the backup is taken:

- **A different line.** Paper to Fabric loses every plugin; a Zomboid build 41
  world does not open in build 42. Versions declare their `line`, and an update
  stays inside it — moving across means a new server. The version panel says a
  newer line exists rather than hiding it
- **An older version.** A world does not open in an older version than the one
  that made it. Rolling back is how an update is undone

The panel never offers either; the API accepts any version id, which is why the
operation checks rather than trusting the button. See
[versions.md](versions.md#lines--what-counts-as-an-update).

**A failed install rolls back automatically. A failed health check does
not.** The difference is how much the platform can be sure of. A
workload that will not start is unambiguous and immediate, so it is
undone without asking. A server that starts and then reports unhealthy
might be unhealthy for reasons that have nothing to do with the update —
and silently reverting somebody's world to a pre-update backup on that
evidence would be a destructive surprise. That stays a button.

## Rolling back

One way back, and only one: the state before the last update. Going back
downloads the previous build if the node no longer has it, then stops the
server, restores the locked backup, reinstalls the previous version and starts
it again.

It **replaces the world**. Anything since the update — blocks placed,
players joined, settings changed in-game — is gone, and the confirmation
says so rather than asking "are you sure?". Afterwards the backup is
unlocked and returns to the retention policy; there is no second way
back, because the one that existed has been taken.

A server with no workload can be rolled back. It used to be told to rebuild
first — on the very version it was trying to leave — and a server with a rollback
point and no workload is usually one the update left that way. Going back needs
the archive, the directory and a node; the workload it makes itself, and starts
it unless the server had been stopped on purpose.

## Rebuilding on the same version

A new workload from the version the server is already on, around the same files.
Two reasons to want one:

- **The workload is gone.** Removed outside the panel, or destroyed by an update
  or settings rebuild that then failed. There is nothing to start, so Start
  refuses and says to rebuild — it used to fall through to the simulator and call
  the server `RUNNING` — and the page leads with a banner giving the recorded
  reason and a **Rebuild** button. The rebuilt server is started, since nobody
  rebuilds a server to leave it off, unless it had been stopped on purpose.
- **The definition changed what a workload is given.** Zomboid build 41 moving
  from `public` to the `legacy41` branch reaches an existing server only through a
  new workload — and the version panel says when. What each workload was made
  from (the build, its environment without its secrets, arguments, mounts, how
  its ports are published, its limits) is recorded on the server when it is
  made, and compared with what it would be made from today
  ([`domain/games/workload.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/games/workload.ts)): "A rebuild
  is pending… would change the build it runs; 2 start-up variables
  (JVM_XX_OPTS, …)". New memory or CPU limits saved in Settings show the same
  way. A workload made before this was recorded says nothing — not known is not
  needed — until its next rebuild. **Rebuild on this version** sits in the version panel; it stops
  the server gracefully, rebuilds, and starts it again if it was running. A
  stopped server's new workload is never started — it used to be started and
  stopped again, which for Terraria was thirty seconds and a kill during boot,
  and is now about a second. It is also how an existing server picks up a
  private port moving to loopback.

The version comes from the catalog link, never a guess, and a version Geeboard no
longer installs is refused. No backup is taken, deliberately: the world is not
touched, the old workload is destroyed with `withData: false`, and a failure
removes only what the rebuild made. A build that is no longer on the node —
removed by hand, or by a clean-up — is downloaded first, shown as it goes, while
the server keeps running; only then is it stopped.

## Deleting

The node comes first. Dropping the row while the workload is still running would
leave something the panel can no longer see, holding a port and a directory
nobody can reach — so a node that refuses is a delete that does not happen, and
says why. Deletion requires typing the server's name.

Where it is: the server's **Settings**, under **Danger zone** — reached from the
Settings tab on its page, or from a node's **Retire this node** card, which links
each server's delete. Until September 2026 neither pointed there: the tabs on a
server's page other than Console were buttons that did nothing, and the retire
card said "delete its servers" without saying where.

**A last backup first.** The confirmation offers one more backup, off-site,
before anything is removed — ticked by default when it can be taken (an agent on
the node, a bucket configured), and saying why when it cannot. If it is asked for
and fails, nothing is deleted: a last backup that quietly did not happen is worse
than none offered. It is a `PRE_DELETE` backup named `final-<date>`.

**What is in the bucket outlives the server.** An off-site backup's row is not
deleted with its server: it loses its server and keeps what it was a backup of —
the name, the game, the owner whose permission still applies, and the id its
object key was built from. It stays on the Backups page as "*name* · deleted",
and from there can be checked (present in the bucket at the size uploaded),
deleted (which removes the object), or **restored into another server of the
same game**. Until the release work the rows cascaded away, the objects stayed in
the bucket with nothing naming them, and the panel said every snapshot was gone.

**So does its history.** Every line the audit log has about the server — its
creation, its settings, the commands typed into it, its backups and mods, and
the line saying it was deleted — stays, named after it: the link to the row is
set to null and the server's name and slug are written onto each line in the
same transaction as the delete. The Audit page shows such a server struck
through and "· deleted", its search finds it by name, and **Every event of this
server** filters to it. A slug taken again by a newer server finds both
servers' lines, each saying which is deleted. Until September 2026 the lines
went with the row, and only the one saying it had been deleted remained.

What leaves the machine: the container, the server's directory, what its image
had downloaded for itself (a cache mount — see [games.md](games.md#where-its-files-live)),
and its backup archives. The archives live beside the directory rather than in it, and until
September 2026 they were left behind — while the panel dropped their rows and said
every snapshot was gone, so they could no longer be seen, restored or deleted from
anywhere but the machine's disk.
