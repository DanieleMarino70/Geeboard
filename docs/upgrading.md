# Upgrading from one release to the next

**Run the installer again.** That is the whole procedure:

```bash
cd Geeboard
git pull                                  # or: git checkout v0.8.1
sudo bash deploy/linux/install-panel.sh
```

Re-running it is what upgrades the panel, and since 0.9.0 it does the careful version of it, in this
order:

1. **Looks at what is in flight.** A server that is being updated, backed up, restored or installed, or a
   backup that is running, is half-finished work that stopping the panel would leave half-finished. It says so
   and asks (`--force` goes on without asking; under `--yes` it stops).
2. **Stops the panel and the poller.** A poller pass in progress is finished first, which for a scheduled
   backup can take minutes: the containers are given two minutes (the panel, thirty seconds) before they are
   killed, which is what the systemd unit's `TimeoutStopSec` always was.
3. **Takes a dump of the database** into `/var/backups/geeboard/` (`--backup-dir` for somewhere else), a
   directory only root can read, with the secrets file copied beside it, and reads the dump back
   (`pg_restore --list`) before it believes in it. It checks first that the disk has the room, and says how
   much it needs. `--no-backup` skips all of this, for somebody who has their own.
4. **Applies the migrations**, once, and keeps what Prisma said. The ones it applied are listed with the time
   each took. A migration that fails stops everything there — see below.
5. **Updates the games catalog** from the definitions this release carries, with no network, so that a game or
   a version the release added is a row before somebody tries to make a server of it.
6. **Starts the panel and the poller**, checks that they answer, and **prints the commands that undo the
   upgrade**, with this dump's name in them.

Game servers keep running throughout. They run on the nodes, and the nodes do not need the panel to keep a
world up; what stops for a minute is the panel's pages, the watchdog and the scheduler. A scheduled task that
falls in the gap is skipped and rescheduled if it is more than fifteen minutes late, not run late.

**If `git pull` refuses** — *Your local changes to the following files would be overwritten by checkout*,
naming scripts under `deploy/` — the checkout was made before 0.9.0. Its scripts were recorded without the
execute bit, so the installer's `chmod` made every one look modified. Nothing of yours is in them. Tell git
once to ignore permission bits in this checkout, and pull again:

```bash
git config core.fileMode false
git pull
```

From 0.9.0 the scripts are recorded executable and none of this happens again. The installer says it when it
sees a checkout in this state.

## What the panel does when the database is not at its schema

A release brings its own migrations, and a panel that starts on a database that has not had them used to find
out at the first query that touched a new column, and say *Something went wrong, trying again usually works*. It
now compares the migrations its image carries with the ones the database says it applied:

- **A release behind** — the migrations were not applied: the panel and the poller print one line (*The database
  is a release behind this one: its last migration is …, and Geeboard 0.9.0 needs 2 more*) and the command, and
  do not start. Under Compose they restart and say it again until you run `migrate`. A panel that is already
  running when the schema changes under it shows the same sentence on every page instead of a page that fails
  its own way, and checks again every half minute.
- **A release ahead** — the database has migrations this image does not know, because a newer release migrated
  it and an older image was started on it. It is not something to run: the old code reads the new schema
  without complaint until the day it writes. Run the newer release again, or go back to the dump taken before
  that upgrade.
- **A migration that did not finish** — named, with the way out below.

`docker compose -f deploy/panel/docker-compose.yml run --rm panel status` says the same from a terminal: the
migrations the database has applied, and the ones this image has that it has not.

## Undoing an upgrade

Migrations only go forwards, and the 0.7.0 one moves data and drops columns, so there is no going back from a
release without the dump the installer took. The data goes back from the dump; the code goes back by naming the
old image. The installer prints these commands at the end of an upgrade, and when a migration fails, with the
real file names:

```bash
docker compose -f deploy/panel/docker-compose.yml stop panel poller
docker compose -f deploy/panel/docker-compose.yml exec -T db sh -c 'dropdb -U geeboard geeboard && createdb -U geeboard geeboard'
docker compose -f deploy/panel/docker-compose.yml exec -T db pg_restore -U geeboard -d geeboard < /var/backups/geeboard/geeboard-<stamp>-from-<version>.dump
# the image that was running, in deploy/panel/.env:   GEEBOARD_PANEL_IMAGE=geeboard-panel:before-<stamp>
docker compose -f deploy/panel/docker-compose.yml up -d
```

The image that was running is kept under the name `geeboard-panel:before-<stamp>` as the installer begins, so
that a build from a checkout (which replaces `geeboard-panel:local`) cannot take it away. The dump was taken
with the panel stopped, so restoring it puts the data back exactly as it was; the `pg_restore` has no `--clean`
because it goes into an empty database, which is what the second command makes. Worlds are on the nodes and are
not part of any of this.

## When a migration fails

The installer stops, shows what Prisma said, leaves the panel and the poller **stopped**, and prints this and
the undo commands above. A migration that fails half-way is **not** rolled back for you: what it did before it
stopped is still in the database, which is why nothing is started on top of it.

Two ways out. Go back to the dump, as above. Or put the cause right (Prisma's words name the migration and the
error), tell Prisma the migration will be run again, and run the installer again:

```bash
docker compose -f deploy/panel/docker-compose.yml run --rm panel resolve --rolled-back <the migration's name>
sudo bash deploy/linux/install-panel.sh
```

If you finished the migration by hand, `resolve --applied <name>` says so instead. Anything it already created
and the migration would create again has to be dropped first. A migration is never edited after a release, so
the usual cause is the data, not the file: the one in 0.4.1 stops on two servers that share an address and says
which.

## By hand, with Docker

Everything above is `install-panel.sh`; this is the same thing spelled out for somebody who runs Compose
themselves. The image is pinned in `deploy/panel/.env`, not exported: an exported variable is gone from the
next command, which then falls back to `geeboard-panel:local`.

```bash
cd Geeboard
sudo docker compose -f deploy/panel/docker-compose.yml stop panel poller

# 1. the dump, and the secrets beside it
sudo install -d -m 700 /var/backups/geeboard
sudo sh -c 'umask 077; docker compose -f deploy/panel/docker-compose.yml exec -T db pg_dump -U geeboard -Fc geeboard > /var/backups/geeboard/geeboard-$(date -u +%Y%m%dT%H%M%SZ).dump'
sudo cp deploy/panel/.env /var/backups/geeboard/panel-$(date -u +%Y%m%dT%H%M%SZ).env

git pull                                   # or: git checkout v0.8.1

# 2. the new image: take the published one and pin it —
sudo sed -i 's|^GEEBOARD_PANEL_IMAGE=.*|GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:0.8.1|' deploy/panel/.env
sudo docker compose -f deploy/panel/docker-compose.yml pull panel poller
# — or build it from the checkout:   docker compose -f deploy/panel/docker-compose.yml build panel

# 3. migrate (and the catalog), then start
sudo docker compose -f deploy/panel/docker-compose.yml run --rm panel migrate
sudo docker compose -f deploy/panel/docker-compose.yml up -d
sudo docker compose -f deploy/panel/docker-compose.yml logs -f panel poller
```

The panel and the poller are stopped before `migrate` so that nothing is reading a table while its shape
changes. `migrate` is `prisma migrate deploy` followed by an offline catalog sync: it applies the migrations the
new release brought, in order, never resets, never seeds, never prompts.

## Without Docker

```bash
cd /opt/geeboard
sudo systemctl stop geeboard-panel geeboard-poller
sudo -u postgres pg_dump -Fc geeboard | sudo tee /var/backups/geeboard/geeboard-$(date -u +%Y%m%dT%H%M%SZ).dump > /dev/null
sudo cp /etc/geeboard/panel.env /var/backups/geeboard/panel-$(date -u +%Y%m%dT%H%M%SZ).env
sudo -u geeboard git pull
cd web
sudo -u geeboard npm ci
# The environment file is read by a shell, as systemd reads it for the service, and handed to the one command.
# (`xargs` fails on the apostrophe in the file's first comment, and puts every secret on the process list.)
sudo bash -c 'set -a; . /etc/geeboard/panel.env; set +a; runuser -u geeboard -- npx prisma generate'
sudo bash -c 'set -a; . /etc/geeboard/panel.env; set +a; runuser -u geeboard -- npm run db:deploy'
sudo bash -c 'set -a; . /etc/geeboard/panel.env; set +a; runuser -u geeboard -- npm run games:sync -- --offline'
sudo -u geeboard env NODE_ENV=production npm run build
sudo systemctl start geeboard-panel geeboard-poller
```

To go back: stop both, `sudo -u postgres dropdb geeboard && sudo -u postgres createdb -O geeboard geeboard`,
`sudo -u postgres pg_restore -d geeboard /var/backups/geeboard/geeboard-<stamp>.dump`, check out the old
release, `npm ci`, `npx prisma generate`, `npm run build`, start.

## Backing up the panel

Geeboard's backups copy each server's world. Nothing in them copies the panel's own database — accounts, the
encrypted node tokens, the bucket's keys, the record of every backup, the audit log. Two things, kept together:
a dump of Postgres, and the secrets file (`deploy/panel/.env`, or `/etc/geeboard/panel.env`). The node tokens
and the bucket's keys in the dump are encrypted under `SECRETS_KEY`; a dump restored beside a different key is
a panel that can reach none of its nodes and has to have every one registered again.

```bash
# Docker
docker compose -f deploy/panel/docker-compose.yml exec -T db \
  pg_dump -U geeboard -Fc geeboard > geeboard-$(date +%F).dump
cp deploy/panel/.env geeboard-$(date +%F).env

# Without Docker
sudo -u postgres pg_dump -Fc geeboard > geeboard-$(date +%F).dump
sudo cp /etc/geeboard/panel.env geeboard-$(date +%F).env
```

## The nodes

An agent is upgraded on its own machine, after the panel:
`sudo bash deploy/linux/install.sh` with no arguments on Linux, which pulls the
image for the version of the checkout it is run from; on Windows,
`install-node.ps1` with no arguments —
[installation.md](installation.md#windows-a-scheduled-task). Its saved settings
carry over and its servers are not touched.

**Panel first, then the agents, and do not leave it long.** A panel and an
agent work together when they speak the same contract — a number each half
carries, which goes up only when one could no longer read the other — or, for
an agent from 0.4.0 or before, which sends none, when they share a release line:
`0.1.x` with `0.1.y` below 1.0, the major from 1.0 on
([nodes.md](nodes.md#panel-and-agent-versions)). Each release says in the
[CHANGELOG](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md) whether it raised the contract; if it did not, an
agent from 0.4.1 or later needs no upgrade at all. Between the two steps a
node may be behind, which is exactly why the heartbeat does not refuse one: the servers on it keep running and the panel keeps seeing it. What it
will not do is put a *new* server on a node it cannot speak to, and the node's
page says so in a banner until its agent catches up. Nor, from 0.3.0, will it
update, roll back or rebuild a server on that node, or apply a setting that
needs a rebuild: each downloads its build first, which an older agent cannot do.
**Ask the node** on its Mods tab is refused too, because an older agent reads a
mod's download the old way. Joining a new machine with the wrong agent is
refused outright.

**From 0.2 to 0.3, that is every node.** 0.3.0 is a new release line: upgrade
the panel, then each agent, as above. Until a node's agent is on 0.3 its page
says *This node runs agent 0.2.4, and the panel is 0.3.0*, the create wizard
shows it greyed out with the same sentence, and a rebuild or an update there
answers *Upgrade the agent, then try again*. Its servers keep running, and the
next heartbeat after the agent's restart clears all of it.

**From 0.3 to 0.4, that is every node.** 0.4.0 is a new release line, though the
agent in it is the 0.3.5 agent: upgrade the panel, then each agent, as above.
Until a node's agent is on 0.4 its page says *This node runs agent 0.3.5, and the
panel is 0.4.0*, the create wizard greys it out, and an update, a rollback or a
rebuild there answers *Upgrade the agent, then try again*; its servers keep
running, and the next heartbeat after the agent's restart clears all of it. One
migration, which `panel migrate` applies. Two things to know before people sign
in: a member sees only the servers given to them from now on, and nothing of the
workspace — give them their servers from the Owner card on each server's Settings
page; and DNS records are written only once an owner or admin sets a provider on
the new DNS page, so nothing happens to any address until somebody does
([servers.md](servers.md#dns)).

**From 0.8 to 0.9, upgrade the agents, though nothing is refused if you do not.** The agent's contract is still 1,
so every agent from 0.4.1 on is accepted and works, and the 0.9.0 agent only adds. It is worth doing soon all the
same: an agent before 0.9.0 can be stopped by a request of one line from anybody who can reach its port, still
empties a world before it knows a restore will finish, and fails a backup of any file that grows while it is
read. Panel first, as always; `sudo bash deploy/linux/install.sh` on each node.

**From 0.7 to 0.8, no agent needs upgrading.** The agent's contract is still 1, and the agent in 0.8.0
is the 0.4.1 agent with its version moved. One migration, which `panel migrate` applies and which moves no
data: a DNS provider gets a column for a webhook's address, empty for the Cloudflare or DuckDNS you
have, and nothing about them changes. `rekey` seals that column too, so run it with the 0.8.0 panel and not
the one before. Two things look different without being asked: the off-site storage form asks *Where is the
bucket?* and **refuses a region that the endpoint contradicts** — a saved bucket is untouched, but saving it
again with the endpoint of Amazon or Backblaze and the wrong region is now refused with the right one; and
the DNS page offers a third provider, a [webhook](dns-webhook.md). If you have a receiver in mind and the
panel's machine is on the same LAN, `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1` in `deploy/panel/.env` is what lets
the panel call it, as for a notification webhook. **0.8.0 was tagged and never published as an image**; what you
install is 0.8.1, which has the same panel and the same agent, and a repaired CI.

**From 0.6 to 0.7, no agent needs upgrading.** The agent's contract is still 1, and the agent in 0.7.0
is the 0.4.1 agent with its version moved. The network figures the history draws were always in what the
agent returns; the panel kept none of them. Two migrations, which `panel migrate` applies. **The first moves
data**: a server's DNS record, which was four columns of `servers`, becomes a row in a table of its own, one for
each kind of record, and the migration copies each server's written record into it — its provider id, its
address, when it was last tried — before it drops the columns. A server whose last try had failed and written
nothing keeps no row and is tried again by the poller, which is where it was. Nothing is written to a
provider, and nothing is asked of one. **Back up the database first**, as for every release; the columns
do not come back. The second adds the network and disk columns to the samples, a table of node samples and
the fields the panel keeps to take a difference of network counters from, and drops `tps`, which was written
as a constant and read by nothing. The history before the upgrade has no network or disk figures, and the
charts say so by drawing none for it. A node now has a *Public IPv6 address*, empty; nothing changes about a
record until somebody sets one, and Minecraft: Java servers on Cloudflare get an SRV record on the poller's
next pass.

**From 0.5 to 0.6, no agent needs upgrading.** The agent's contract is still 1, and the
agent in 0.6.0 is the 0.4.1 agent with its version moved. The panel has one migration, which
`panel migrate` applies: two tables, one for the revisions of community games and one for
the owner's list of registries. Nothing changes until somebody proposes a game, and a game
runs only on a node whose machine declares `community-games`, which no node does after an
upgrade: it is `--community-games` on the installer, or the line in the agent's environment
that [Community games](community-games.md#the-node) names. If you want it, read what an
image can do first, and consider `deploy/linux/container-firewall.sh`.

**From 0.4 to 0.5, no agent needs upgrading.** The agent's contract is still 1, so
the agents you have — on 0.4.0 or 0.4.1 — go on working, and the node pages say
*contract 1* for the ones that are on 0.4.1. (The agent in 0.5.0 is the 0.4.1
agent with its version moved, because a release tags the panel and the agent
together.) The panel has two migrations, which `panel migrate` applies: a table
for notification channels and what is queued for them, and one for saved
templates. Nothing is sent and nothing changes until somebody sets a channel up
on the new **Notifications** page; after its next catalog sync the poller writes
one audit line, *server.update.available*, for each server that has an update
waiting, which is where *an update is available* comes from. If the
panel's machine has ntfy or Home Assistant on the LAN to send to, set
`GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1` in `deploy/panel/.env` first
([notifications.md](notifications.md#where-a-webhook-may-point)); it is off, on
purpose, until you do. An off-site bucket whose address is a cloud metadata
address, which nobody has, would stop being called; one on this machine or the
LAN is unaffected.

**From 0.4.0 to 0.4.1, nothing is refused on the way.** It is one release line, so
the agents on 0.4.0 go on working, and the agent in 0.4.1 is the 0.4.0 agent with one
addition: it now says which contract it speaks (1). Upgrade the agents when it is
convenient, not before; from then on a panel that does not raise the contract never
asks for another agent upgrade. What the release line still decides is an agent that
sends no contract: a panel on 0.5 would refuse one on 0.4.0, once. One migration,
which `panel migrate` applies and which stops on two servers that share an address
(case aside) and says which — rename one from its Settings page, then run it again
([servers.md](servers.md)); and one more, a column for the contract. If you keep
`SECRETS_KEY` in `.env`, `rekey` now changes it without losing anything
([security.md](security.md#changing-secrets_key)).

**From 0.3.x to 0.3.5, nothing is refused on the way.** The panel has two
migrations, which `panel migrate` applies; an agent older than 0.3.5 keeps
working, and is shown as *agent too old* on the Terminal page until it is
upgraded. The terminal stays off on every node until somebody switches it on
at the machine — `sudo bash deploy/linux/install.sh --terminal`, or
`install-node.ps1 -Terminal` — and it is never switched on by an upgrade
([nodes.md](nodes.md#node-terminal)).

The panel's own version is under its name in the sidebar; a node's is on the
node's page. Upgrading a node while the panel is still on the old release is
the one order that does not work: an older panel does not know what a newer
agent expects.

## What was tried

On a PC with Docker Desktop, against the compose file above: a database left
exactly as the previous release makes it — its last migration not applied and
the column it adds absent — with an owner, a node and a server in it; a dump
taken; the new image built; `migrate` run; the panel started. The migration
applied, the rows were all still there, the owner signed in, and the dump
restored into a second database with the same row counts.

The 0.2 to 0.3 window, on the same PC, with the panel at 0.3.0 and the node's
agent run from the `v0.2.4` tag under its own identity: the heartbeat was
accepted and recorded 0.2.4, the node's page carried the banner, the wizard
greyed the node out with the reason, a rebuild and Ask the node were refused
with it, and a Zomboid server on the node kept running throughout. With the
agent started again from 0.3.0, the next heartbeat recorded it, the banner went,
the node could be chosen, and the same rebuild and Ask the node went through —
the Zomboid server still up, never restarted.
