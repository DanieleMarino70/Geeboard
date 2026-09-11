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
        RESTARTING · UPDATING · BACKING_UP · DELETING
                                      ↓
                         CRASHED · ERROR · SUSPENDED
```

**Platform-owned** states — `CREATING`, `INSTALLING`, `UPDATING`, `BACKING_UP`,
`DELETING`, `SUSPENDED` — outrank whatever the runtime reports. A server
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

Anything that fails after step 4 takes the row with it. The rollback asks the
node to remove the whole footprint **by server id**, which reaches both a
workload and a directory — a timeout says nothing about whether the server was
made, so the rollback has to assume it was.

A node with no agent attached produces a real row and a simulated server, and
the result says so rather than pretending.

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
server's startup line is not a failed check. A server inside its boot grace —
900 seconds for Zomboid, 1200 for Rust, because both build a map on first
boot — is not broken, and restarting it would break something that was working.

A **crash line outranks a passing probe**: a process that has printed
`java.lang.OutOfMemoryError` is not healthy because its socket is still open.

`query` and `rcon` probes are declared by several games and **not executed
yet** — they are reported as skipped rather than counted as passes. Running them
needs either game protocol knowledge on the node, which is the one place it must
not go, or an endpoint that writes arbitrary bytes to a port on request.

## Settings

Two kinds, and the difference is not a detail:

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

## Reconciliation

A server can crash at 3am, or be stopped by hand on the node. Neither goes
through the panel. `npm run poll` asks every reachable node what is actually
true, every fifteen seconds:

- Platform-owned states are held, and counted as `held` in the report
- Drift becomes an activity event — `server.crashed`, `server.recovered`,
  `server.stopped.unexpectedly`
- Transitions the panel asked for are not news
- A running server gets a metric sample written while we are there

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

## Schedules

`runDueTasks` runs inside the poller process, every pass. Backups, restarts,
broadcasts, commands and cleanups all do their work; a broadcast uses the game's
own wording from its definition.

A task more than fifteen minutes late is **skipped and rescheduled** rather than
run. Catching up matters for some jobs and is actively wrong for others: a panel
that was down overnight should not wake up and fire six hours of restarts in a
row.

Scheduled runs are attributed to a `Scheduler` system account rather than to
whoever created the task — they did not press anything at 03:00, and an audit
log that says they did is one nobody can trust.

## Deleting

The node comes first. Dropping the row while the workload is still running would
leave something the panel can no longer see, holding a port and a directory
nobody can reach — so a node that refuses is a delete that does not happen, and
says why. Deletion requires typing the server's name.
