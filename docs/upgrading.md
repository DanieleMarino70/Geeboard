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
git pull                                   # or: git checkout v0.2.0
docker compose -f deploy/panel/docker-compose.yml build
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
`sudo deploy/linux/install.sh` with no arguments on Linux, the three lines in
[installation.md](installation.md#windows-a-scheduled-task) on Windows. Its
saved settings carry over, its servers are not touched, and the panel says so
when a node's agent is too old for something it is asked to do — rotating a
token, a health query — rather than failing.

Upgrade the panel first. A newer panel talks to an older agent and says what it
cannot do; an older panel does not know what a newer agent added.

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
