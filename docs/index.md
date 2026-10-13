# Geeboard

An open-source panel that runs game servers on machines you already have. You
bring the machines; Geeboard installs a small agent on each one, and from a
single panel you create servers, start and stop them, watch their console,
edit their files, back them up and move them between machines.

## From a machine to a game server

<a id="or-install-it-for-real"></a>Three steps, each with a page of its own.

**The panel.** On a Linux machine with Docker and git — a VPS, or a PC that
stays on:

```bash
git clone --branch stable https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
sudo bash deploy/linux/install-panel.sh
```

The installer asks whether you have a domain name and who the first owner is,
then makes the secrets, puts https in front of the panel — a certificate from
Let's Encrypt with a domain, one Caddy signs itself without — starts
everything, and shows the first owner's temporary password once. You do not
edit `.env`, `docker-compose.yml` or the `Caddyfile`, and nothing there uses
the development seed. [Install Geeboard](production.md) is this step in full.

**A node.** The installer's last question offers the same machine as one, with
nothing to paste. Any other machine, Linux or a Windows PC with Docker Desktop,
runs the one command the panel writes for it under **Nodes → Add a node**.
Either way the node waits until somebody presses **Approve**:
[Registering a node](nodes.md#registering-a-node).

**A game server.** **Servers → Create a server**: a game, a version, its
resources and the node, which the wizard says can run it before the last step.
[Creating one](servers.md#creating-one).

When a step does not go as written, [When it will not start](troubleshooting.md)
has what has really happened on machines, and what to do.

## Or try it on a laptop

<a id="try-it-on-a-laptop"></a>Postgres in Docker, the panel from a checkout, and a sample workspace:

```bash
git clone --branch stable https://github.com/DanieleMarino70/Geeboard.git && cd Geeboard
docker compose up -d                 # Postgres

cd web
npm ci
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
need a machine — and this one will do, if it runs Docker:
[A checkout, and nodes in depth](installation.md).

## Four things, not one

These are routinely conflated and they are not the same:

| | What it is | Who owns it |
| --- | --- | --- |
| **VPS / physical server** | A machine that already exists | You. Geeboard never buys, creates or resizes one. |
| **Geeboard node** | That machine, running the agent and registered with the panel | Geeboard knows about it |
| **Game server** | A Minecraft world, a Terraria map, a Zomboid save | Geeboard manages it |
| **Runtime** | How the node actually executes it — a container today | The node |

Placement decides *which existing node* hosts a new server. It does not
provision infrastructure. The one integration with a provider is opt-in and
narrow: a DNS record for a server's address, at Cloudflare or DuckDNS, or sent to a
receiver of your own for any other DNS, when one is configured. It can also tell a Discord channel or a webhook when
a server crashes, a node goes quiet or a backup fails — once one is set up, and
never before.

## Before you plan around it

<a id="where-to-go-next"></a>[What works today](what-works.md) is the inventory, [What does not work yet](limitations.md)
the other half of it, and [the roadmap](roadmap.md) what 1.0 promises and what may
come after it. What changed between releases, and what an upgrade asks of you, is the
[changelog](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md).

## Licence

Geeboard is licensed under the GNU Affero General Public License, version 3
only — `AGPL-3.0-only`. If you run a changed version that other people use over
a network — a hosted panel is exactly that — you have to offer them its source
under the same licence.

The games are not part of Geeboard. A node pulls each game's server from its
own image, under that image's and that game's terms — Minecraft's image, for
one, is started with `EULA=TRUE`, which accepts Mojang's EULA on the operator's
behalf.
