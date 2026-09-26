# Upgrading from one release to the next

Back up, fetch the new code, apply its migrations, restart — in that order,
because the first is the only one that can be skipped without anybody noticing
until it matters.

Game servers keep running throughout. They run on the nodes, and the nodes do
not need the panel to keep a world up; what stops for a minute is the panel's
pages, the watchdog and the scheduler. A scheduled task that falls in the gap is
skipped and rescheduled if it is more than fifteen minutes late, not run late.

## Backing up the panel

Geeboard's backups copy each server's world. Nothing in it copies the panel's
own database — accounts, the encrypted node tokens, the bucket's keys, the
record of every backup, the audit log. Two things, kept together:

1. **A dump of Postgres.**
2. **The secrets file** — `deploy/panel/.env`, or `/etc/geeboard/panel.env`. The
   node tokens and the bucket's keys in the dump are encrypted under
   `SECRETS_KEY`; a dump restored beside a different key is a panel that can
   reach none of its nodes and has to have every one registered again.

```bash
# Docker
docker compose -f deploy/panel/docker-compose.yml exec -T db \
  pg_dump -U geeboard -Fc geeboard > geeboard-$(date +%F).dump
cp deploy/panel/.env geeboard-$(date +%F).env

# Without Docker
sudo -u postgres pg_dump -Fc geeboard > geeboard-$(date +%F).dump
sudo cp /etc/geeboard/panel.env geeboard-$(date +%F).env
```

To put one back, into an empty database, with the panel and the poller stopped:

```bash
docker compose -f deploy/panel/docker-compose.yml exec -T db \
  pg_restore -U geeboard -d geeboard --clean --if-exists < geeboard-2026-09-21.dump
```

## Docker

```bash
cd Geeboard
# 1. back up, as above
git pull                                   # or: git checkout v0.3.1

# Either take the published image for that release — and put the same line
# in deploy/panel/.env so every later command uses it —
export GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:0.3.1
docker compose -f deploy/panel/docker-compose.yml pull panel poller
# or build it from the checkout:
# docker compose -f deploy/panel/docker-compose.yml build

docker compose -f deploy/panel/docker-compose.yml stop panel poller
docker compose -f deploy/panel/docker-compose.yml run --rm panel migrate
docker compose -f deploy/panel/docker-compose.yml up -d
docker compose -f deploy/panel/docker-compose.yml logs -f panel poller
```

The panel and the poller are stopped before `migrate` so that nothing is reading
a table while its shape changes. `migrate` is `prisma migrate deploy`: it applies
the migrations the new release brought, in order, and does nothing else — it
never resets, never seeds, never prompts.

## Without Docker

```bash
# 1. back up, as above
cd /opt/geeboard && sudo -u geeboard git pull
cd web
sudo -u geeboard npm ci
sudo systemctl stop geeboard-panel geeboard-poller
sudo -u geeboard env $(sudo cat /etc/geeboard/panel.env | xargs) npm run db:deploy
sudo -u geeboard env NODE_ENV=production npm run build
sudo systemctl start geeboard-panel geeboard-poller
```

## The nodes

An agent is upgraded on its own machine, after the panel:
`sudo bash deploy/linux/install.sh` with no arguments on Linux, which pulls the
image for the version of the checkout it is run from; on Windows,
`install-node.ps1` with no arguments —
[installation.md](installation.md#windows-a-scheduled-task). Its saved settings
carry over and its servers are not touched.

**Panel first, then the agents, and do not leave it long.** A panel and an
agent work together when they share a release line — `0.1.x` with `0.1.y`
below 1.0, the major from 1.0 on
([nodes.md](nodes.md#panel-and-agent-versions)). Between the two steps every
node is one line behind, which is exactly why the heartbeat does not refuse
one: the servers on it keep running and the panel keeps seeing it. What it
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

The panel's own version is under its name in the sidebar; a node's is on the
node's page. Upgrading a node while the panel is still on the old release is
the one order that does not work: an older panel does not know what a newer
agent expects.

## If it goes wrong

Migrations only go forwards. To go back to the release you were on: stop the
panel and the poller, restore the dump you took in step 1 into an empty
database, check out the old release, build, start. The worlds are on the nodes
and are not part of any of this.

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
