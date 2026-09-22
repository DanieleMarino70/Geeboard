# Geeboard

An open-source panel that runs game servers on machines you already have. You
bring the machines; Geeboard installs a small agent on each one, and from a
single panel you create servers, start and stop them, watch their console,
edit their files, back them up and move them between machines.

It is not a Docker dashboard. Docker is how a machine happens to execute a
server today; the panel, the API and the database speak in games, versions,
nodes and servers, and one of those four could be swapped without touching the
others.

## Four things, not one

These are routinely conflated and they are not the same:

| | What it is | Who owns it |
| --- | --- | --- |
| **VPS / physical server** | A machine that already exists | You. Geeboard never buys, creates or resizes one. |
| **Geeboard node** | That machine, running the agent and registered with the panel | Geeboard knows about it |
| **Game server** | A Minecraft world, a Terraria map, a Zomboid save | Geeboard manages it |
| **Runtime** | How the node actually executes it — a container today | The node |

Placement decides *which existing node* hosts a new server. It does not
provision infrastructure, and there are no cloud provider integrations.

## Try it on a laptop

Postgres in Docker, the panel from a checkout, and a sample workspace:

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git && cd Geeboard
docker compose up -d                 # Postgres

cd web
npm install
npm run setup:env                    # writes .env with two generated secrets
npm run db:migrate
npm run db:seed                      # the sample workspace
npm run dev                          # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard` — the development seed's account,
whose password is written in this repository, which is exactly why it refuses
to run in production.

The sample workspace is fixtures: fictional nodes with no agent behind them and
servers that are simulated, marked as such on screen. To see real servers you
need a machine — and this one will do, if it runs Docker. That is
[Add a node](nodes.md).

## Or install it for real

[Install Geeboard](production.md) is the other case, and it is three commands:

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
sudo bash deploy/linux/install-panel.sh
```

The installer generates the secrets, writes the configuration, puts https in
front of the panel — with a certificate from Let's Encrypt if you have a domain
name, and one Caddy signs itself if you do not — starts everything, and makes
the first owner with a temporary password shown once. You do not edit `.env`,
`docker-compose.yml` or the `Caddyfile`, and nothing there uses the seed.

## Where to go next

| | |
| --- | --- |
| [Install](production.md) | From a clone to an owner signed in, on a PC or a VPS |
| [Advanced installation](advanced-install.md) | The same, one command at a time, for an administrator |
| [Add a node](nodes.md) | Attach a machine and let it run games |
| [Operate](servers.md) | Servers, backups, versions, and the games on offer |
| [Upgrade](upgrading.md) | Moving to the next release without losing anything |
| [Reference](reference.md) | The HTTP API, security, and how the pieces fit |
| [Develop](development.md) | Layout, scripts, tests, conventions |
| [Roadmap](roadmap.md) | Where the project is and where it goes |
| [What works today](what-works.md) | The inventory, in one list |
| [Changelog](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md) | What changed between releases, and what an upgrade asks of you |
| [What does not work yet](limitations.md) | Read this before you plan around it |

## Licence

Geeboard is licensed under the GNU Affero General Public License, version 3
only — `AGPL-3.0-only`. If you run a changed version that other people use over
a network — a hosted panel is exactly that — you have to offer them its source
under the same licence.

The games are not part of Geeboard. A node pulls each game's server from its
own image, under that image's and that game's terms — Minecraft's image, for
one, is started with `EULA=TRUE`, which accepts Mojang's EULA on the operator's
behalf.
