---
title: Operate
nav_order: 4
has_children: true
---

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
   that game's own limits.
2. **Check the node** — not draining, not under maintenance, not unreachable.
3. **Check capacity** against committed totals, and refuse with the numbers.
4. **Claim the port block.** The row is written *first*, because inserting it is
   what actually claims the port: a unique index on `(nodeId, port)` turns a lost
   race into a failed insert to retry rather than two servers bound to one
   address. Five attempts, walking the game's stride.
5. **Provision on the node**, with rendered environment and resource limits.
6. **Record** the audit event and the daily backup schedule.

While step 5 runs the wizard shows which of the installer's steps it is on —
prepare, provision on the node, write its settings, start — asked once a second
of `GET /api/install-progress?key=…` with a key the wizard made up and sent with
the create. A route and not a server action, because Next runs one client's
actions one after another and this one would wait behind the call it is asking
about. It shows the step and not a percentage: provisioning is where the minutes
go, when a node has to pull a build, and the node does not say how far through a
pull it is.

Anything that fails after step 4 takes the row with it. The rollback asks the
node to remove the whole footprint **by server id**, which reaches both a
workload and a directory — a timeout says nothing about whether the server was
made, so the rollback has to assume it was.

A node with no agent attached produces a real row and a simulated server, and
the result says so rather than pretending. A simulated server carries a
`simulated` badge on the servers list and its own page, with a banner saying
nothing is running; its start, stop and restart report as warnings, never as
successes, and are recorded as `started (simulated)` and so on. The simulator
settles only servers with no workload on a node with no agent — it once settled
any server stuck in `STARTING` or `STOPPING`, which let a page render declare a
real server whose start had failed `RUNNING`.

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
console and type only into their own.

The suggestions under the input are the game's own `console.examples`. The server
overview shows the last six lines the node returned when the page was drawn —
labelled as such, not as live — or says why there are none: no agent, no
workload yet, or the node did not answer within two and a half seconds. It used to
show a fixture Minecraft log with a pulsing "live" dot on every server.

The full console page still shows that fixture for a server on a node with no
agent, labelled as simulated. A server on a real node with no workload gets a
sentence saying so and a link to its page, not the fixture.

## Files

Confined to `<dataRoot>/<serverId>` on the node, checked twice: a lexical check
catches `../`, and a `realpath` check catches a symlink pointing out of the
tree, which no amount of string handling would see. The server root cannot be
deleted, and a file over 2 MB is reported rather than streamed into a browser
textarea.

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
| `ALWAYS` | Restart whenever it stops |

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
back up     locked, so retention cannot take the way back
stop        a world half-written by an update is not a world
rebuild     destroy the workload, keep the data, install the new version
start
record      what it was on, so going back is a button
```

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
stops the server, restores the locked backup, reinstalls the previous
version and starts it again.

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
removes only what the rebuild made.

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

What leaves the machine: the container, the server's directory, what its image
had downloaded for itself (a cache mount — see [games.md](games.md#where-its-files-live)),
and its backup archives. The archives live beside the directory rather than in it, and until
September 2026 they were left behind — while the panel dropped their rows and said
every snapshot was gone, so they could no longer be seen, restored or deleted from
anywhere but the machine's disk.
