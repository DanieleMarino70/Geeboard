# Geeboard

An open-source panel that runs game servers on machines you already have. You
bring the machines; Geeboard installs a small agent on each one, and from a
single panel you create servers, start and stop them, watch their console, edit
their files, back them up and move them between machines.

It is not a Docker dashboard. Docker is how a machine happens to execute a
server today; the panel, the API and the database speak in games, versions,
nodes and servers, and one of those four could be swapped without touching the
others.

```
                          Geeboard Panel
                                │
                          Control API
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
        Game catalog                        Node registry
      games · versions                            │
      config · health              ┌──────────────┼──────────────┐
                                   │              │              │
                                Node           Node           Node
                              Frankfurt        Milan        Amsterdam
                                   │              │              │
                                Runtime        Runtime        Runtime
                                   │              │              │
                             Game servers   Game servers   Game servers
```

Five games run for real today — Minecraft Java, Minecraft Bedrock, Terraria
(vanilla and TShock), Valheim and Project Zomboid — each from its own image on
a real node, with a live console, backups that are verified before they are
restored, and health that asks the game rather than the container. **What does
not work yet is written down too**, in one place, and it is worth reading
before you plan around any of it.

## Try it

```bash
docker compose up -d           # Postgres
cd web && npm install && npm run setup:env && npm run db:migrate
npm run db:seed && npm run dev # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard` — the development seed's account,
whose password is written in this repository, which is exactly why it refuses
to run in production. Installing it for real is `npm run setup`, and a
different page.

## Documentation

**<https://danielemarino70.github.io/Geeboard/>** — install, add a node,
operate, upgrade, the HTTP API, security, architecture, the roadmap, and what
does not work yet.

The same pages are in [docs/](docs/) and read on GitHub as they are.

## Licence

Geeboard is licensed under the GNU Affero General Public License, version 3
only — `AGPL-3.0-only`. The full text is in [LICENSE](LICENSE).

In short, and not in place of the licence: you may use, study, change and share
it. If you share a changed version, or run one that other people use over a
network — a hosted panel is exactly that — you have to offer them its source
under the same licence (section 13). "Only" means a later version of the
licence does not apply unless the project chooses it.

The games are not part of Geeboard. A node pulls each game's server from its
own image, under that image's and that game's terms — Minecraft's image, for
one, is started with `EULA=TRUE`, which accepts Mojang's EULA on the operator's
behalf.
