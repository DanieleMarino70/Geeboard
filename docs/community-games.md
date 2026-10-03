# Community games

A community game is a game nobody at Geeboard wrote: a **manifest** — a game
definition in JSON — that names a container image and says how the panel is to
run it. Geeboard ships eight definitions; a manifest is how a ninth comes from
somebody else without a release.

It is also the one place the project runs code chosen by a person. The rest of
this page is about that: what a manifest can say, what it cannot, who has to agree
before it runs, and what an image can still do once it does. Read
[What an image can do](#what-an-image-can-do) before you approve one or install a node
that takes them.

## In short

1. An owner or admin **proposes** a manifest: paste it or choose a file on
   *Games → Community games*. The panel checks it against the rules below and keeps it
   as a *revision*. A revision that is waiting runs nothing, is in no wizard and is
   on no node.
2. An **owner** reads what it would run — the image to the digest, the ports, the
   folders, the words typed at its console, the files written, every regular
   expression — and **approves it with a fresh code from their authenticator**.
   The approval is for the exact manifest that was read, by its SHA-256.
3. The game is then in the create wizard, labelled *community*, and can be placed
   **only on a node whose machine has said it will run community games**. A node
   that has not is refused with a sentence that names the capability.
4. An owner or admin can **retire** it. Servers already running it go on running
   and can still be managed; no new one can be made.

Nothing is fetched from the Internet to make a manifest: it is pasted or uploaded,
there is no address to give. Nothing here changes the agent, and the contract
stays 1.

## Who has to agree

Three parties, and none of them can do another's part.

| | Does | Cannot |
| --- | --- | --- |
| **An owner or admin** | proposes a manifest; turns a waiting one down; retires a game | approve; change which registries are allowed |
| **An owner** | approves, with a fresh authenticator code; sets the registries an image may come from | approve with the code they signed in with, or with one already used |
| **The machine's operator** | declares `community-games` on the node, when installing or joining | be overruled from the panel: there is no switch for it there, and an API key has no way to propose or approve |

The permissions are `community.propose` (owners and admins) and `community.approve`
(owners only). Neither is in any API scope: **there is no API to propose or approve a
game**, on purpose.

Approving is the same kind of act as opening a terminal on a node, so it asks for the
same thing: the current six digits, not the code that signed you in, which is spent.

## What an image can do

This is the part to read. It is measured, on Docker Desktop and on a real Linux
machine at a cloud provider, not assumed; the measurements are in the project's
release notes for 0.6.0.

**What the agent will not give a game's container.** It builds every container from a
fixed list of options, and a test in the agent holds that list. A game cannot be
privileged, add capabilities, be given a device, join the host's network or process
namespace, mount anything of the node's but its own server's folder and at most two
cache folders beside it, or publish a port below 1024. A manifest has no field to ask
for any of these, and a hand-written request to the agent that carries them is
answered with a container that does not have them — they are not read.

**What any container gets from Docker, and so what an image can do.**

- It runs **as root inside its container**, with Docker's default set of
  capabilities, for as long as it runs. It cannot mount a filesystem and cannot see
  Docker's socket or the node's files.
- It uses as much of the memory and CPU it was given as it can, and writes as much into
  its own server's folder as the disk allows. It can read, change or delete everything
  in that folder: its world, its settings files, whatever else is there.
- It can **talk to the Internet and to everything on the node's own network**,
  including services on the node itself that listen on every address. On the machines
  measured, from a container on Docker's default bridge: SSH on the node (`22`), the
  agent's port (`8080`, the agent runs on the host's network) and the proxy's (`80`,
  `443`) answered. The panel's own port and its database did not, because a standard
  install binds one to the loopback address and does not publish the other.
- On a cloud machine it can **read the provider's metadata service at
  `169.254.169.254`**, which can hold credentials. This answered HTTP 200 from a
  container on a real node. It is true of every game Geeboard hosts, not only
  community ones; with images chosen by a person it is the main risk of this feature.

There is no network sandbox in Geeboard, and a manifest cannot promise one. What there
is instead is three things, in the order they act:

1. **The node's consent.** An image of a community game runs only on a node whose
   machine declared `community-games`. See [The node](#the-node).
2. **What the owner is shown.** The approval page lists what the image can and cannot do
   in these words, and what this particular game would run.
3. **Rules you can put on the machine.** [Keeping containers off the node
   itself](#keeping-containers-off-the-node-itself) is a script that closes the two ways
   above, tested on a real node.

## The manifest

A manifest is a `GameDefinition` as JSON, plus `"manifest": 1`. The eight definitions
Geeboard ships all survive that round trip unchanged, which is why there is no second
format: see [Games](games.md) for what each field means. What a manifest does not carry
is what a definition written by a developer would: it is never `official`, its versions
come from the manifest and nowhere else, and it has no `mods` and no download — an
image is the only way to install one.

The checker is a closed list. A field that is not on it is an error, and not something
to ignore, because a field ignored today is where a manifest hides something that
tomorrow's panel will read. What comes out is not the object that came in but a new one,
built from what was checked, so nothing unchecked can be in it.

### A real example

Factorio, from the `factoriotools/factorio` image. The panel's own test reads this block
and requires it to pass, so the example cannot go out of date.

```json
{
  "manifest": 1,
  "id": "community-factorio",
  "name": "Factorio",
  "family": "Factorio",
  "art": "FAC-\nTORIO",
  "blurb": "Factory automation. The headless server from the factoriotools image, a new map on first start.",

  "portBase": 34197,
  "portSpan": 100,
  "ports": [
    { "id": "game", "label": "Game", "offset": 0, "container": 34197, "protocol": "udp", "primary": true }
  ],

  "defaults": { "memoryGb": 2, "cpuLimit": 150, "diskGb": 10, "playersMax": 16 },
  "limits": { "memoryGb": [1, 8], "cpuLimit": [50, 400], "diskGb": [5, 60] },
  "requirements": {
    "memoryGbMin": 1,
    "cpuPctMin": 50,
    "diskGbMin": 5,
    "os": ["linux"],
    "arch": ["x64"],
    "capabilities": ["docker"]
  },

  "install": { "kind": "image" },
  "dataPath": "/factorio",

  "config": [
    {
      "key": "preset",
      "label": "Map preset",
      "type": "enum",
      "target": { "kind": "env", "name": "PRESET" },
      "default": "default",
      "options": [
        { "value": "default", "label": "Default" },
        { "value": "rich-resources", "label": "Rich resources" },
        { "value": "rail-world", "label": "Rail world" },
        { "value": "death-world", "label": "Death world" }
      ],
      "group": "World",
      "help": "Only applies when the map is made, on the first start. An existing map keeps the settings it was made with.",
      "restartRequired": true
    }
  ],

  "health": {
    "probes": [{ "kind": "log", "pattern": "Hosting game at" }],
    "bootGraceSeconds": 180,
    "readyPattern": "Hosting game at",
    "crashPattern": "Factorio crashed"
  },

  "console": {
    "saveCommand": "/server-save",
    "examples": ["/players", "/server-save", "/time", "/seed"],
    "players": {
      "join": "\\[JOIN\\] (?<name>.{1,40}) joined the game$",
      "leave": "\\[LEAVE\\] (?<name>.{1,40}) left the game$"
    }
  },

  "versions": [
    {
      "id": "stable-2-0-77",
      "line": "stable",
      "label": "Factorio 2.0.77",
      "upstream": "2.0.77",
      "image": "docker.io/factoriotools/factorio:stable@sha256:b4951bbde08f83dbe578b9276eeb350d19ce7263b8427f0acb77dbfe70f0e321",
      "note": "The image's stable tag, as it was on 2026-10-03",
      "released": "2026-09-22",
      "channel": "stable",
      "recommended": true
    }
  ],

  "templates": [
    {
      "id": "default",
      "name": "Default map",
      "blurb": "A new map with the game's own settings.",
      "summary": "Default preset, 16 slots",
      "config": { "preset": "default" }
    }
  ]
}
```

What was found by running it, for whoever writes the next:

- The image's own `PORT` is 34197 and it opens an RCON port on 27015; neither needs to
  be set, and the manifest publishes only the game's UDP port.
- On the first start it makes a map (`_autosave1`) by itself, which is why there is no
  save name to set. `PRESET` is read only at that moment, so the setting's help says so.
- Ready is the line `Hosting game at …`, printed about a second and a half after the
  container starts. With no account token it also prints an *Error … Missing token*
  line about listing itself publicly and goes on hosting; so the crash pattern is
  `Factorio crashed`, which is what the game prints when it segfaults, and not
  `Error`.
- It stops on `SIGTERM`, saving, so there is no `stopCommand`. The panel's
  `/server-save` writes a save before a backup.
- Join and leave lines are `[JOIN] <name> joined the game` and `[LEAVE] <name> left the
  game` in the game's documented log format. **They were not seen with a real client
  connected**, so the player count is unproven for this game.
- The image is named by the digest of its index, which holds one image for each
  platform, so the same manifest pulls the right one on an `arm64` node.

### The rules, and why each is there

| Rule | Why |
| --- | --- |
| **The size of a manifest is 64 KB** and its nesting 12 levels; at most 60 problems are reported | A manifest is read by the panel before anybody approves it |
| **An id is `community-` and a name** of 2 to 31 lowercase letters, digits and dashes, and never a game Geeboard ships | Servers are stored under their game's id |
| **A family is never one Geeboard ships** (Minecraft, Terraria, Project Zomboid, Valheim, Rust, Palworld, Satisfactory) | The panel finds a server's game through its family; a community game that took *Minecraft* would be taken for one of its editions |
| **An image is `registry/name[:tag]@sha256:<64 hex>`: the digest is not optional** | What is approved has to be what runs. A tag moves; a digest cannot, so a new image under the same tag is another manifest to read |
| **The registry has to be on the owner's list**, `docker.io` and `ghcr.io` to begin with | The agent would pull from anywhere. The panel is what holds this line, and the list is the owner's |
| **No `mods`, no `download`, no `steamBranch`; install is an image; versions are static** | Each fetches something after approval that nobody read |
| **No `srv`** | An SRV record is written into the owner's own DNS zone, under the server's name, by the panel. A game Geeboard ships may ask for one; a manifest may not in this release, since that is a rule of trust of its own |
| **Ports**: 1 to 8, none of 22, 80, 443, 2019, 3000, 5432, 8080 or 8711 in the block, none below 1024 | The node, the proxy, the panel and the agent listen there |
| **Mount points**: the server's folder and at most two caches, up to five segments deep, none under a system directory | They follow the agent's own rules, so a manifest is refused here rather than at the first create |
| **Environment names** are valid and none begins with `GEEBOARD_` | Those are the panel's own variables, and the panel adds them |
| **Files a setting writes** are inside the server's folder: relative, no `..`, no leading dot | A setting is not a way to write elsewhere |
| **A setting's key** is plain: letters, digits, dots, dashes, underscores | It cannot start another line of a file |
| **A setting is `env`, `properties`, `ini`, `lua`, `lua-base` or `arg`; not `json`** | The panel cannot write a JSON file yet, and a game that was approved and then could not be created would be worse than a refusal here |
| **A password-like setting says `secret`**, by the rule the shipped games are held to | It is not shown, not logged, not kept in a template |
| **Limits**: at most 30 versions, 60 settings, 100 options a setting, 10 templates, 8 probes, 20 known failures, 16 arguments of 200 characters, 2 cache paths | A page has to be readable |
| **Text is bounded and has no control characters**; a release date is a real date | Whatever is printed to an owner has to be what was written |
| **Every regular expression is safe** — see below | A pattern is run on every line a game prints |
| **A default or a template a setting would refuse is refused** | A game that cannot be created with its own defaults |
| **The registry's own audit** passes | The same consistency check a shipped definition faces |

### Regular expressions

A manifest brings patterns — what the ready line looks like, who joined — and the panel
runs each on every line the game prints. A pattern that takes exponential time freezes
the panel's process: `^(a+)+$` takes 22 seconds on 32 characters, measured. Three
defences, one behind the next:

1. **A static rule** at proposal: at most 200 characters, no back-references and no
   look-behind, at most 100 of anything counted and 3 unbounded repeats, and no repeat
   inside an unbounded group. All 36 patterns Geeboard ships pass it.
2. **A timed run** at proposal and again at approval: each pattern against lines built to
   hurt it, in a separate context that is cut off after 40 ms.
3. **A guard at run time** for the patterns of an approved community game, whatever they
   passed: every line is cut to 2000 characters and each match is stopped after 25 ms. A
   pattern that was too slow is skipped for that line and logged; it does not stop the
   panel.

## Checking a manifest without a panel

The checker is a function, and a command runs it on files — for somebody writing a
manifest who has no panel to paste it into, and for a repository that collects them and
wants every proposal checked before anybody reads it. It is in `main`, after the 0.6.0
release, and in the release that follows; from a checkout of Geeboard:

```bash
cd web
npm install
npm run manifest:check -- path/to/manifest.json
npm run manifest:check -- games/                       # every manifest.json under it
npm run manifest:check -- games/ --registries docker.io,ghcr.io,quay.io
npm run manifest:check -- games/ --json                # one JSON array, for a script
```

It exits 0 when every manifest passes, 1 when one does not, and 2 when it could not run
(nothing to check, a path that is not there, an option it does not know). A failure names
the field by its path, as the page does. It uses the registries a workspace starts with
unless `--registries` says otherwise, so it cannot know what an owner's own list allows.

**Passing means the manifest is well formed and safe to put in front of an owner.** It does
not mean the digest is of the image you mean, that the image exists, or that the game runs:
the first is for the owner reading the approval page, the others are for testing.

## Getting a digest

Use the digest of the image index, so a node of any platform pulls what it needs:

```bash
docker buildx imagetools inspect factoriotools/factorio:stable
```

The line `Digest: sha256:…` at the top is the one to use, written as
`docker.io/factoriotools/factorio:stable@sha256:…`. The tag is for reading and the digest
is what is pulled. Check what the digest is a digest *of*: a manifest says what its
author says an image is, and the approval page shows the image to the digest, with its
registry and repository first, precisely so the owner can look at it.

## Approving, replacing and retiring

*Games → Community games* lists every revision with its state, who proposed it and who
decided. A page for one revision shows:

- the manifest's SHA-256, which is what the approval is bound to,
- **what an image can do on the node**, and what the agent will not give it,
- for each version the image to its digest, the arguments it starts with and its
  environment, the panel's own variables named apart,
- the ports and who can reach each, the folders and the limits,
- every word the panel will type at its console, the files it will write, the settings
  and where each lands, and every expression it will run,
- the manifest as it was given.

The approval checks the manifest again at that moment against the registries as they are
now, and that what is stored still hashes to what was proposed; a row edited by hand in the
database does not approve and does not load. The authenticator code is checked last, so a
refusal does not use one up.

States: **waiting**, **approved**, **turned down**, **replaced** (an older approved
revision, when a newer one is approved: there is never more than one) and **retired**.
A game that was retired can be proposed again; it becomes a new revision.

Retiring takes the game out of the wizard and out of templates and clones. It does not
stop a server, change a server, or remove its backups: servers keep running, can be
stopped, started, backed up and deleted, and say *community · retired* beside the name.

Every step is in the audit log, as a line that names the game, the revision and the
first twelve characters of the hash — never the manifest, a setting or a code.
Approving, retiring and changing the registries are warnings.

Each approved game is read back from the database by every panel process — the web
process every ten seconds, the poller on every pass — **checked again**: hashed, and put
through the same checker. A game that does not pass is skipped and logged.

## The node

A game that is not official needs the node's machine to have said so. The capability is
`community-games`, and it is the same kind of consent as the node terminal: given by
whoever owns the machine, on the machine.

A new node, on Linux:

```bash
sudo bash deploy/linux/install.sh https://panel.example.com <token> --community-games
```

and on Windows:

```powershell
.\deploy\windows\install-node.ps1 -Panel https://panel.example.com -Token <token> -CommunityGames
```

Either is `--capabilities community-games` for the join, added to the others if there
are any. **The Add a node dialog has no checkbox for it**, and its command never carries
the flag: whoever can click in the panel is not thereby whoever owns the machine. The
agent reports it on every heartbeat, so it shows on the node's page within a minute, with
a sentence about what it means.

A node that has already joined declares it by adding the capability to what it declares
now: on Linux, a line `GEEBOARD_CAPABILITIES=<the others>,community-games` in
`/etc/geeboard/agent.env`, then the installer run again with no options; on Windows, the
capabilities list in the agent's `agent.json`. Taking it away is the same edit the other
way. The installers refuse `--community-games` on a run that does not join, and say so.

A node that has not declared it is refused for a community game when the server is
created, in the wizard's list of nodes — *cannot run this game — Missing Community games*
— and by anything that places a server.

## Keeping containers off the node itself

`deploy/linux/container-firewall.sh` closes the two ways in
[What an image can do](#what-an-image-can-do) that a firewall can close on a node you
own. It is worth running on any node that takes community games, and on a cloud machine
before the first one.

```bash
sudo bash deploy/linux/container-firewall.sh add [--ports 22,8080]
sudo bash deploy/linux/container-firewall.sh status
sudo bash deploy/linux/container-firewall.sh remove
```

It adds three rules and nothing else, each with the comment
`geeboard-container-firewall` so `remove` takes away exactly what `add` put there:

| Chain | Rule | Why there |
| --- | --- | --- |
| `DOCKER-USER` | reject anything to `169.254.169.254` | Traffic from a container to the network crosses the machine's `FORWARD` chain, where Docker leaves this one chain for you |
| `INPUT` | reject TCP to the given ports from `docker0` | Traffic from a container to the machine **itself** does not cross `FORWARD`, so `DOCKER-USER` cannot stop it |
| `INPUT` | the same from `br-*` | The bridges Docker makes for networks of its own |

It does not touch a game's published ports, the way out to the Internet, DNS, traffic
between containers or IPv6 (Docker's bridge has none unless you turned it on), and it
does not affect a container started on the host's network, which Geeboard never does for
a game. By default it protects ports 22 and 8080: SSH and the agent. The agent's port
wants a token the container does not have, but there is no reason to leave it open.

**Tested on a real machine** (Ubuntu with kernel 7.0 and `iptables` 1.8.11 on the
`nf_tables` backend, at OVH), from a container made the way the agent makes one:

| From a container | Before | After |
| --- | --- | --- |
| the node's SSH, `172.17.0.1:22` | reachable | refused |
| the agent, `172.17.0.1:8080` | reachable | refused |
| the proxy, `172.17.0.1:80` | reachable | reachable (not in the list; add `--ports` for it) |
| `169.254.169.254` | answered | unanswered |
| `1.1.1.1:443`, DNS, an HTTPS page | worked | worked |
| a game's published port, from another machine | answered | answered |

To keep it across a reboot, run it from a unit that starts after Docker — `DOCKER-USER`
only exists once Docker has made it:

```ini
# /etc/systemd/system/geeboard-container-firewall.service
[Unit]
Description=Keep game containers away from this machine's own services and the cloud metadata service
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/geeboard-container-firewall add
ExecStop=/usr/local/sbin/geeboard-container-firewall remove

[Install]
WantedBy=multi-user.target
```

```bash
sudo install -m 0755 deploy/linux/container-firewall.sh /usr/local/sbin/geeboard-container-firewall
sudo systemctl daemon-reload
sudo systemctl enable --now geeboard-container-firewall
```

Starting and stopping that unit was tested, and the rules went and came back. A reboot
and a restart of Docker were not; a restart of `docker.service` restarts a unit that
`Requires` it, which is why it is written that way.

## The registries

The owner's list of where an image may come from is on *Games → Community games*:
`docker.io` and `ghcr.io` to begin with, at most ten, each a plain host name. Widening it
approves nothing — it decides what may be *proposed* — and **narrowing it stops a waiting
revision from being approved**, because the check is made against the list as it is at
that moment. A game that is already approved keeps the image it was approved with and
is not unapproved by a change to the list.

## The API

`GET /api/v1/games` lists a community game like any other, with `"community": true` and
the id and hash of the revision that was approved, and it lists none that is waiting or
retired. A server's `game` is the game's id. There is no route to propose, approve, turn
down or retire a game, and no API scope that could carry one.

## What this does not do

- **It is not a sandbox.** An approved image runs as root in its container with the
  reach described above. What this page offers is consent, a reading, and rules you can
  put on the machine; it is not a promise about what an image does.
- **It does not read the image.** The digest says *which* bytes will run, not what they
  do. The only evidence about what is inside is whatever the owner has about its author.
- **It does not fetch a manifest** from an address, a repository or a catalogue, and
  there is no catalogue of community games. A manifest is pasted.
- **A JSON settings file cannot be written.** A game that needs one is not expressible yet.
- **Windows and macOS nodes** run community games the same way and have no
  `container-firewall.sh`. On a PC at home the metadata service is not there, and the
  node's own services are the ones to think about.
- **A player count is only as good as the pattern.** A community game's join and leave
  patterns are the author's, and are tested here only against the lines in the manifest's
  own description of them.
