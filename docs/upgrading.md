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
git pull                                   # or: git checkout v0.6.0

# Either take the published image for that release — and put the same line
# in deploy/panel/.env so every later command uses it —
export GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:0.6.0
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
