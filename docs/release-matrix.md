# What was run before 0.9.0, and again before 0.9.5

0.9.0 was meant to be the release in which nothing is trusted because it is written down. Before it was
cut, a list of situations that a person installing or upgrading Geeboard will really be in (the *matrix*,
26 cells) was run on machines, not read off the code. This page is what each cell was, where it ran, what
happened, what it found, and what was **not** done. [limitations.md](limitations.md) is the list of what
the product cannot do; this is the list of what was and was not shown to work.

A cell is *run* when someone did it and read the output, *partly* when the variants it names were not all
tried, and *not run* when nothing was. Where a figure comes from a single run it says so. Nothing here was
run on an arm64 machine, against a real DNS provider from inside this release, or on a machine with less than 12 GB
(smaller memory limits were put on a larger machine by hand).

## The machines

| Name | What it is |
| --- | --- |
| **deb** | A clean Debian 13 VPS (6 vCPU, 11.7 GB of memory, 99 GB disk, kernel 6.12, Docker 29.8.2) with a public IPv4 and IPv6 address. Where the matrix says Ubuntu 26.04, it was this |
| **PC** | A Windows 11 desktop behind a home router: Docker Desktop (Linux containers, a 7 GB VM), Node.js, Windows PowerShell 5.1, and two WSL2 distributions, Ubuntu 22.04.5 and 24.04, each with Docker installed in it |
| **CI** | GitHub Actions: `ubuntu-24.04`, `ubuntu-26.04` (allowed to fail), `windows-latest` |

Everything on deb was run against the branch the release was cut from, built on the machine (`--build`),
because the images of an unreleased version do not exist.

## Run again before 0.9.5

0.9.0's list says what it could not do: a real DNS provider and a real certificate from inside the release, an upgrade
*to* a release rather than from an old one, a panel put back from a dump. 0.9.5 ran those, on **deb** again (the Debian 13
VPS, with the published 0.9.0 images moved in place, then the branch built on the machine), with a real domain and a real DNS zone
(`geeboard.party`, at Cloudflare). Each line says what happened; the ones that found something say what.

| What | Result |
| --- | --- |
| **A panel at a domain, with Let's Encrypt, on the machine that is also its node** | Run, from the published 0.9.0. The certificate was issued 4 seconds after Caddy was reloaded, and the panel answered over https from the PC with no `-k`. **Found three bugs, fixed in 0.9.5:** the installer's check for Caddy's unit (`systemctl list-unit-files | grep -q` under `pipefail`) said there was none and Caddy was never reloaded; changing the panel's address from an IP to a name left the node on that machine calling the old one; and a *name* that resolves to the machine was not read as the machine, so the Docker networks were left out of the agent's port rule and the node went degraded with a false "across the internet" warning. |
| **A real DNS provider** | Run. The Cloudflare token was accepted from the DNS page; the panel wrote an `A`, an `AAAA` and an `SRV` record for each of two Minecraft servers, and the three were seen from 1.1.1.1, 8.8.8.8, 9.9.9.9 and Cloudflare's own name server; deleting a server removed its records. |
| **An address with no port** | Run, with a protocol client (`minecraft-protocol`, the library most bots use): it resolved `mc3.geeboard.party` through the `_minecraft._tcp` record with no port typed and connected to the record's port, 25568; the panel counted 1 / 40 within a poll and the Players page listed the join and the leave. **The official client was not tried** ([field checks](field-checks.md)). |
| **A Minecraft server at the definition's minimum memory** | Paper at 1 GB was killed by the kernel during start-up (`OOMKilled`, in `dmesg`); the minimum is 2 GB. |
| **The update check, over https** | Run: a file named `release.json` served by a Caddy site on the machine with its own Let's Encrypt certificate, `GEEBOARD_UPDATE_URL` pointing at it, naming a release (that does not exist) with a security floor. The Updates page, the Dashboard banner, the node's page and the *a newer Geeboard is out* activity line all said so, in the file's own sentence; the variable reached both containers. (The first compose file did not pass it on; the audit found that, and a test now holds the file to the documentation.) |
| **The upgrade from 0.9.0 to the 0.9.5 branch** | Run. `install-panel.sh --build --yes` on the running panel with five game servers (three Terraria, two Minecraft): 3 minutes end to end, of which the panel did not answer **5 seconds** (a poll of `/api/health` once a second from the PC: four failed). One migration (`update_check`, 0.03 s). The dump was read back, and the commands that undo it printed. The five game containers' start times were the ones from before; the agent on the machine went from 0.9.0 to 0.9.5, contract 1; the data root became `0711` and the archive and upload folders `0700`. |
| **Going back, as printed** | Run. The commands the installer printed (stop, drop and create the database, `pg_restore` of the dump, the old image named in `.env`, `up -d`): **5 seconds** from stop to a healthy 0.9.0, the schema at the old migration and the new table gone; five users, five servers and one node were all there, and no game container had moved. A panel at 0.9.0 with an agent at 0.9.5 worked. |
| **Forward again** | Run, the same 5 seconds, the migration applied again; the Caddyfile was rewritten (the installer says it will), which dropped the test site above. |
| **A panel lost, and put back** | Run. `uninstall-panel.sh --volumes --env` (the stack, the database and the secrets, after a dump with a copy of the secrets), `install-panel.sh` (a clean install: an empty database and a new key), `restore-panel.sh` with the dump and the copy: **67 seconds** in all. The key was the old one again, the old owner signed in with a password and a one-time code (whose secret is sealed under that key), the DNS page still held the Cloudflare token and the zone, the node was healthy, the five servers were listed, and no game container had moved. |
| **The firewall script, with a rule iptables refuses** | Run in a Debian container with `NET_ADMIN`: apply, apply again (the new chain is swapped in beside the old one, one rule in `INPUT` before and after, no leftover chain), `status`, an `--allow` that iptables refuses (it said so, **changed nothing**, and the old rules were still in force), and `remove`. |
| **The agent's tests on Linux** | Run in a Debian container (`--init`): 281 pass; the ones that need a Docker engine (`integration.test.ts`, one terminal test) have no engine there and fail the same on the commit before. |
| **The images' bill of materials and provenance, and signing** | Rehearsed: a local registry and a key, in CI as well; the commands (`cosign verify`, `attest`) were proved with the key. **The keyless signature has not been seen**: it exists only for a release that has been cut, and `cut.mjs after` says whether it is there. |
| **An independent audit** | Nine reviewers, told to attack: about fifty findings, each fixed or written down ([the list](limitations.md#found-by-the-audit-of-095-and-left)). Where a fix could be run for real it was: the backup archiver against a link swapped in during the walk, a FIFO in a game folder, a rename onto a taken name, a role sent as an object. |

Not done, and said: **IPv6 from another network** (the machine side is proved: the `AAAA` record, `docker-proxy` on `[::]`, the machine reaching its own global address, `ip6tables`; the external checker that was tried cannot resolve a name that has only an `AAAA` record); **the official Minecraft client**; **a person with a screen reader**; **a clean Windows PC with no Node and no Docker**; **arm64**; **the keyless signature**. Each has a card in [field-checks.md](field-checks.md).

## M01, an existing panel upgraded in place

**Run, on deb.** A panel as 0.4.1 shipped it, installed from the 0.4.1 tag by its own installer (101 s), with
two Terraria servers created through its API, a backup, a nightly backup task and a console command each.
Inventory before: 4 users, 1 node, 2 servers, 2 backups, 4 tasks, 22 audit rows, 1 API key, 37 migrations.

- **The documented upgrade of that time failed.** `git pull` on the checkout the 0.4.1 installer had left
  aborted, naming eight scripts: that installer had made them executable, and git saw them as modified.
  `git checkout` of the branch did the same. `git config core.fileMode false` once, as
  [upgrading.md](upgrading.md) now says first, and both go through.
- **The upgrade itself:** `install-panel.sh --build --yes`, 182 s end to end, of which the panel did not answer
  `/sign-in` for **27.1 s** (50 failed polls, one every half second from outside). Memory on the machine peaked at
  5.2 GB used while the image built. The last words said *upgraded from 0.4.1* and printed the commands that undo it.
- **Afterwards,** every count was the one before except the audit log, which had the upgrade's own two rows; the
  database was at the branch's migrations; the old API key still opened the panel; the agent on the machine had gone from
  0.3.5 to 0.8.1, contract 1; the doctor said *Nothing to put right*; and the **game containers had not moved**
  (their start times, read before and after, were the same).
- **It found a defect.** Both servers read *UNHEALTHY, the console has not reported it ready*, and stayed so. 0.4.1
  never wrote down when each console said it was ready, the health check then judged a server on the last 120 lines of its
  log, and a busy server pushes its ready line out of them in minutes. A data migration now records it for the servers that
  were running. Proved by putting the 0.4.1 dump back with `restore-panel.sh` (the migrations that dump lacks were applied,
  eleven of them) and watching both servers come up `RUNNING`.
- **The version-skew drill.** The agent was put back to 0.3.5, which sends no contract. The node stayed `HEALTHY`;
  a new server was refused with `NODE_INCOMPATIBLE` and the sentence that names both numbers; a server it already ran
  could still be sent a console command, backed up, stopped and started; an update was refused. Upgrading the agent the
  documented way (`install.sh`) made it contract 1 and a new server was accepted. The running game's container did not
  restart through any of it.

**Not covered:** a provider snapshot (the machine was a throwaway), the 0.4.0 agent, and a non-empty DNS table (the 0.4.1
database has none; the migration that copies records was proved by `npm run verify:upgrade` on a constructed database).

## M02, a clean machine with no Docker

**Partly: Debian 13, not Ubuntu 26.04.** A box that was 13 minutes old, with neither git nor Docker. The README's first
command failed (`git: command not found`), so the README now says a new Debian or Ubuntu has neither. `install-panel.sh`
stopped with *Docker is not installed* and the one line to run; that line took 12 s. Installing the panel in address mode
(published 0.8.1 images) took 63 s and adding the machine as a node 33 s. The teardown (`uninstall.sh --purge`,
`uninstall-panel.sh`, Docker and Caddy removed) ended 0, put the Caddyfile back and freed 37.4 GB. The teardown found a defect:
`geeboard-agent-port.service` stayed *active (exited)* for a unit that no longer existed, until the next boot (fixed).

**Not covered:** Ubuntu 26.04 itself, a provider reinstall, and the first-minutes race for the package manager's lock
(the box was past it, and Caddy installed with no wait).

## M03, Ubuntu 22.04 and 24.04

**Run, in WSL2 on the PC (and CI for 24.04 and 26.04).** A WSL distribution is a virtual machine behind the PC's NAT: it
proves behaviour, not reachability from outside.

- **24.04:** a clean machine to a running panel (`get.docker.com`, then `install-panel.sh --yes --build`) in about six and a half
  minutes, image build included. It was given a panel URL, so Caddy was not part of it.
- **22.04.5:** the same, in address mode. **It found two defects, both fixed.** Ubuntu 22.04 has no `caddy` package: the installer
  died at stage 6, after the image was built, with `E: Unable to locate package caddy`. It now says so before it writes
  anything, and `--caddy-repo` (or a *yes*) adds Caddy's own apt repository (see
  [troubleshooting](troubleshooting.md#the-installer-could-not-install-caddy)). And behind the PC's NAT the installer's last
  check asked the machine's own public address, which the router does not loop back, and called a right install *not answering*.
  It now asks Caddy on the machine, naming the address in the handshake with `openssl` (curl sends no name for an address, and Caddy
  then has no certificate for it; the first fix used curl and did not work). On the third run: `--check` warned and exited 1; a
  plain run stopped with nothing written; `--caddy-repo` installed Caddy 2.11.7 and the panel, the HTTPS check answered `200`
  with the certificate verified against the address, the second run and `doctor.sh` were clean, and the uninstall left no
  container. The apt run on a fresh 22.04 took 471 s in WSL, which is WSL's, not the installer's.

**Not covered:** the distribution's own Caddy package on 24.04 (a URL was given); `ufw` and `docker.io` machines; a real 22.04
VPS. CI gained a job that installs with Caddy on 22.04 and 24.04; it is allowed to fail until it has been seen green.

## M04, Docker already installed

**Partly.** On deb after Docker was installed, and on the PC, the installers printed that Docker and Compose were there and
touched nothing on every re-run; on the PC a stand-in that answered *windows* made the installer stop with the *switch to Linux
containers* message. **Not covered:** the snap package, `podman-docker`, `docker.io` without Compose, Compose v1, rootless Docker.
Those refusals exist as pure shell checks with canned answers, not as machines.

## M05, M06, M09, M10: a Windows node

**Partly, and the part the matrix cared about most was not shown.** The PC ran its own agents in isolated tasks and ports (the
real task of another agent on that PC was never touched).

- **Joined to a panel at an address,** with the authority pinned by fingerprint: registered, and heartbeats arrived every 15 s.
  Run again with no arguments, it kept its settings. The same command in `cmd.exe` had its quotes taken off with a note; a bad
  token was refused with the panel's own reason.
- **Over the Internet** (deb's panel, the PC behind its router): the node registered and heartbeated; the panel's call back to
  the PC timed out, and both the installer ("The panel cannot call this PC back, so it will take no servers") and the agent's log
  said so, with both ways out.
- **Killing `node.exe`** brought it back in 13 s; a stale agent started by hand was stopped by the installer; a non-agent on the
  port was left alone and the task exited 78; with Docker unreachable the install said so in three lines; an `O'Brien` path
  installed and ran; the data root on `D:` was kept on a re-join; a token for another name was refused and not spent; Node 18
  and Windows containers were refused.
- **Windows PowerShell 5.1 on CI** parsed every script, and `doctor.ps1` ran to its last line on a machine with no Docker.

**Not shown:** a Windows node *Reached* by a panel (the panel on deb could not call a PC behind a router; a reverse tunnel was
refused and not retried; the same-PC route through WSL failed twice with *connection refused* while that stack was restarting, and
a container could not reach a Windows host listener that a WSL process could, for a cause that was not isolated); Docker Desktop
actually stopped (simulated); sign-out, sleep and a reboot with nobody signed in; a firewall rule *created* (the shell was not
elevated); a second Windows account; **M06, a fresh Windows with no Node and no Docker and the default execution policy, was not run**
(no Windows Sandbox); Windows 10, Home, ARM, Server, Group Policy, TLS-inspecting proxies and security products.

## M07, an address, no domain

**Mostly, on deb.** A bare re-run and a re-run with `--yes` left the Caddyfile (hash), `.env` (hash) and every container's start
time unchanged, on 0.8.1 and on the branch. A panel given `--panel-url … --no-caddy` was kept that way by a bare re-run; `--ip` put
it back. A moved-aside `.env` stopped the run before it wrote anything; a node name that exists was refused. A Linux node with
`--panel-ca sha256:…` pinned the right fingerprint, refused a wrong one showing both, and refused an `http` address. The authority
seen was *Caddy Local Authority 2026 ECC Root*. **Not covered:** a re-run on a Let's Encrypt panel (no domain; the fix is from reading
the code), `--panel-ca <file>` on a node elsewhere, and the clipboard button on a page served over plain http.

## M08, a domain, Let's Encrypt, Cloudflare

**Not run.** It needs a name and a DNS token, and the token could not be found at the time. DNS records had been written to Cloudflare
and DuckDNS in earlier releases (0.4.0 to 0.8.0); nothing was written to a real DNS provider from this release.

## M11, the container firewall

**Run, on deb.** Before the rules, the panel and another container could both reach the agent's port. After `container-firewall.sh add`
(22, 8080, the metadata address): the other container was refused, the panel still got `200`, four rules were first in `INPUT`; `status`
exited 0; `add --ports 22,8080,25565` then `remove` took it to four rules and then none; after `systemctl restart docker` the four rules
were back and the panel still got `200`; `ufw enable` over it left them in place; two reboots left both units active, the agent's port refused
from the PC, the node `HEALTHY` and the HTTPS check `200`. **It found** a first-boot failure of the port unit ("are the same file"), a rule
that named the compose network by an id that changed when the network was recreated (the panel then got *connection refused*; the bridge is
now named `gb-panel`), and that a one-line bad request from the PC killed the agent (see [security](security.md)). **Not covered:**
nftables-only and firewalld hosts; IPv6 rules were checked from the machine itself and from the PC (refused).

## M12, community games on a second Linux node

**Not run.** There was no second Linux node. Only the mapping of the flag to the agent's settings was exercised, as pure shell cases.

## M13 and M14, IPv4 and IPv6

**M13: run** as the baseline: the PC has no global IPv6 address; everything on deb ran over IPv4 except the next cell.

**M14: partly, on deb, which has a global IPv6 address.** `install-panel.sh --ip` with the address bare and bracketed made the panel
`https://[2a02:…]`, written once in brackets everywhere; HTTPS answered `200` over IPv6 from the machine and not over IPv4 while that was the
site; the agent answered `/version` over IPv6 from the machine and its `ip6tables` chain was present; putting the IPv4 address back
restored the IPv4 URL. **Not shown:** an AAAA record reached from another IPv6 machine, a node joining over IPv6, an IPv6-only host. The
agent's IPv6 listener is therefore proved from the node itself only.

## M14b, an old image on a newer database

**Found by mistake and fixed.** A re-run of the installer on the branch without `--build` replaced the working 0.9 panel with the published
0.8.1 image, answered `/api/health` with `404`, and said the schema was up to date (`migrate deploy` has nothing to do when the database is
ahead). The installer now compares the image's migrations with the database's before it stops anything, names the ones the image does not
know, and stops (`--force` goes on). With `--build` the panel came back, `/api/health` `ok`, doctor clean.

## M15, the network cut between the panel and a node

**Run, on deb**, with a dead-man switch that removed the rule after 15 minutes whatever happened. A rule dropped the panel's packets to the agent's
port at 20:42:49, with a backup starting.

| After | The panel's pages | A call to the node | The node | The backup |
| --- | --- | --- | --- | --- |
| before | `200`, 18 to 90 ms | `200` | healthy | running |
| 10 s | `200`, 9 to 15 ms (settings 2.5 s once) | `502 RUNTIME_UNREACHABLE` after 10.0 s | healthy | **failed** |
| 60 s | `200` | `502` after 10.0 s | degraded | failed |
| 130 s and 10 min | `200`, 12 to 90 ms | `502` after 10.0 s | **unreachable** | failed |
| 1 min after it ended | `200` | `200` in 22 ms | healthy | still failed |

The audit log got `backup.failed`, `node.degraded` and `node.unreachable`, once each. The three servers on the node stayed `RUNNING` in the
panel throughout and the panel's own pages never slowed. The failed backup is not retried by itself. **Not covered:** a cut during an upload, a
restore or an image pull; Windows (a firewall rule on the PC).

## M16, the database stopped for three minutes

**Run, on deb** (`docker compose pause db`). While it was paused `/api/health` answered `503` in 5.0 s and `/sign-in` and `GET /api/v1/servers` answered `500` in
5.0 s, the latter with the API's `INTERNAL` code and a reference (a database that is away was not told apart from a bug; it is now
`DATABASE_UNAVAILABLE`, 503 with `Retry-After`, proved against a throwaway Postgres paused the same way); the panel logged one `unexpected error` with its reference ("Connection terminated due to connection timeout") and the poller logged its node calls
timing out. Fifteen seconds after the unpause the health route and the API were back, no server had changed state and no backup was left running.
**Not run:** cutting the panel's outgoing traffic to Discord, Cloudflare or a bucket.

## M17 and M18, a restart in the middle of work

**Run, on deb.** The panel was restarted during a backup of one server: its page answered `200` within 15 s, the backup row was `COMPLETE`, and
a second backup worked, so nothing stayed claimed. The agent was restarted during a backup and during a 200 MB upload: the upload had finished
(the file on disk was 209,715,200 bytes), the backup caught by the restart was marked `FAILED` ("closed the connection before it answered"), one
tried while the agent was down was `FAILED` ("refused the connection … the agent is not running there"), and after the agent returned the node
was `HEALTHY`, every server `RUNNING`, and a console command worked. **Not covered:** a restart during an image pull, a restore, or an update;
Windows (`Stop-ScheduledTask`, a killed `node.exe` was run, and came back in 13 s, but not during an operation).

## M19, a reboot with servers running

**Run, on deb**, three Terraria servers with the three restart policies, then `reboot`. The machine was up at 21:02:11; at 21:02:37 the
`ALWAYS` server was `STARTING` and `RUNNING` by 21:02:57; the `ON_FAILURE` and `NEVER` servers stayed `STOPPED`, which is what those policies say,
and each said why on its page. The audit log had `node.degraded` and `node.recovered`, `server.stopped.unexpectedly` three times,
`server.recovered` for the first and `server.left.stopped` for the other two. The panel, poller and agent were active, the agent's port rule was
in `INPUT`, and the doctor said *Nothing to put right*. A hard reset (`sysrq b`) was run earlier, in the part that made the policies right; it leaves
exit code 255, which the panel treats as a crash. **Not covered:** `systemctl restart docker` alone (run in the firewall cell, without a server),
a reset from the provider's console, the panel host down while the node is up.

## M20, the memory it takes to build

**Run, on deb**, with each build step of the panel image held to a memory limit and swap off.

| Limit | Result |
| --- | --- |
| 3 GB | built, 224 s |
| 2 GB | built, 223 s |
| 1.5 GB | **killed** after 89 s, at `next build` |
| 1 GB | **killed** after 93 s, at `next build` |

So a machine that must build the image (a checkout ahead of any release, or `--build`) needs about 2 GB free for it; the published image needs
nothing of the kind. No machine with 3.8 GB or 1 GB was available; these are limits on a larger one.

## M21, arm64

**Not run.** There was no arm64 machine and no emulation. The images are `linux/amd64`, which the documentation says.

## M22, the clock

**Run, on deb**, last, with NTP off and the clock ten minutes ahead, then ten minutes behind, then restored. Through both, `/api/health` stayed `ok`,
`GET /servers` `200`, an image pull from Docker Hub worked, a request to GitHub got its answer over TLS, a console command was accepted, and the node
stayed `HEALTHY` with its `lastSeen` moving. Audit rows written while the clock was behind carry that clock's time, so they sort before earlier ones.
The logs held one poller line (the connection that held its lock was terminated by an administrator command) and one refused connection to the agent.
A probe of the HTTPS front in that run was aimed at `127.0.0.1`, for which Caddy has no site, so it reads `000` all through; the front answered `200`
at its address before and after. **Not covered:** a certificate that is near its expiry while the clock moves.

## M23, browsers and assistive technology

**Partly, on the PC.** Chrome headless driven over CDP with axe-core: 29 routes (the plan said 31) in both themes at 1280 px, and sweeps at 375, 320
and 768 px. The first sweep found contrast failures on 24 routes (161 elements), unnamed progress bars (88), small targets (16), definition lists
(10) and links told apart by colour alone (4); contrast and links are at zero now, and so is everything else axe finds. It also found
that every page was titled *Geeboard*, there was no skip link, 21 fields drew no focus ring, 14 of 19 pages could not be reached on a phone, 320 px
overflowed, and that the harness had been loading `127.0.0.1`, which the dev server blocks, so for a while nothing it checked had hydrated. The new look was judged by its author from screenshots at five widths; nobody else has seen it yet. **Not done:** NVDA, Narrator, Firefox, a real phone, forced colours, Safari, VoiceOver, TalkBack, and a
production build (it ran against the dev server). Forced colours were looked at in Chrome's emulation, on six pages: the meters' bars had vanished and have an edge and a highlight fill now. Since then (P34): the axe baseline is empty (the progress bars have names, the games list is a list, every target is 24 px), the console, the
wizard, the terminal and the charts were given what a screen reader needs and the console, wizard and charts are checked in the browser (90 checks at 1280, 375 and 320 px); the terminal's
screen-reader mode is built and has not been run against a real shell.

## M24, CI

**Run.** The install job (`install-panel.sh --yes --build` twice, a restart, the health route and the sign-in page, the uninstaller) passed on
`ubuntu-24.04` and `ubuntu-26.04` the first time; the panel and agent images build and the agent answers `/version`; `windows-latest` parses every script
under 5.1 and runs `doctor.ps1`. Defects put in on purpose (a script recorded without the execute bit, a brace removed from a `.ps1`, an old migration
edited) failed the named jobs on a branch that was then deleted. The weekly full run (`full.yml`) passed 34 of 35 on its first runner, in 20 minutes, with
`verify:mods` and `verify:a11y` left out on purpose. The release workflow was rehearsed without publishing: it builds and runs both images and pushes nothing.
**Found by it:** a Windows job that failed because `doctor.ps1` exits 1 on a runner with no Docker; a pull check that assumed it could see a download
mid-way; a test that the panel image could not build with. **Not covered:** `audit.yml` (a workflow file that is not on `main` cannot be dispatched),
`install-node.ps1` on a Windows runner.

## M25, real third parties

**Not in this release's build; yes before it.** Real: DuckDNS (0.4.0), Cloudflare A records (0.4.0) and A, AAAA and SRV on a real zone (0.7.0, documentation
addresses, two runs, none left), Backblaze B2 in both addressing styles (0.8.0), and the DNS webhook receiver on BIND (0.8.0) and, in the audit before this release, on Knot and PowerDNS (33 checks, none failing). **Not run
inside 0.9:** Cloudflare, Let's Encrypt. **Never run:** Amazon S3 and Cloudflare R2 (the forms say *tried: no*).

## M26, measurements that set priorities

**Run, on deb and the PC.** Docker's `stats` with a stream: median 2.0 s a call; one-shot: 2 ms. A pass of the poller over three servers with 1.5 GB each:
median 5.3 s (maximum 9.4 s) before the parts that changed it, 316 ms after; the longest gap between samples went from 157 to 165 s down to 15 s. A hundred
servers on ten nodes at 30 ms a call, against stand-in agents: 3.6 s a pass. `scrypt` for the stored-secret key: 30 ms a read before, 0.01 ms after;
`bcrypt` cost 10: 73 ms, cost 12: 256 ms, and the sign-in itself 258 ms either way. Those timings were on Node 25 on the PC, not Node 24. A killed `node.exe`
came back from the scheduled task in 13 s.

## A month of use, and ten times that

**Run, on deb**, against the panel's real database and the panel's own reads, timed one at a time inside the panel's container (the functions each page calls, five runs, the median).
The tables that grow were filled by SQL to the size a month makes for three servers, then to ten times that, over what the retention keeps: **1×** is 486,000 metric samples (30 days
at one every 16 s, three servers), 173,000 node samples, 200,000 audit events over a year, 5,000 backups and 100,000 player sessions, a database of 296 MB; **10×** is 4.86 million,
1.7 million, 2 million, 50,000 and 1 million, 3.0 GB (the metric samples alone 1.7 GB). It is the same tables ten times as long and not thirty servers: a read of one server's history
is longer than thirty servers' would make it, a read that adds across servers is as long.

| A page's read | 1× (median) | 10× (median) |
| --- | --- | --- |
| Dashboard: stats, recent CPU, last activity | 8, 3, 2 ms | 4, 5, 1 ms |
| Servers, Nodes | 4 ms, 3 ms | 2 ms, 2 ms |
| Players (the last 100 sessions) | 22 ms | 44 ms |
| Analytics, 24 hours / 7 days / 30 days | 19 / 113 / 405 ms | 89 / 648 / 1,220 ms |
| A server's chart, 24 hours / 30 days | 6 / 85 ms | 56 / 467 ms |
| A node's chart, 30 days | 53 ms | 331 ms |
| Audit log: the first page of 30 days / of all time / page 50 | 2 / 13 / 12 ms | 14 / 113 / 114 ms |
| Audit log: a free-text search | 313 ms | 2,188 ms |
| Audit log: the list of actors | 22 ms | 133 ms |
| **Backups page: every backup, unpaged** | 218 ms (5,000 rows) | 562 ms (50,000 rows) |

So the panel answers every page in under half a second at a month of three servers, and in about two seconds at the slowest (a text search of the audit log, which reads the whole table) at ten times that.
The three that grow fastest are the ones that were known to: the Backups page lists every backup and has no page (a year of nightly backups of fourteen servers is the 5,000), the audit search
is a scan, and the analytics windows aggregate every sample in them. None of them is changed in this release. **The pruning of old samples** removed 2,430,846 of 4,860,746 (the ones older than
15 days, as if the poller had been down for a fortnight) and the node samples beside them in **2.1 s**, with `/api/health` answering in 4 to 13 ms meanwhile.

**It found one thing:** a `VACUUM` of those tables stopped with `could not resize shared memory segment … No space left on device`, because Docker gives a container 64 MB of `/dev/shm` and Postgres'
parallel workers use it; the database service has `shm_size: 256mb` now, in both compose files.

## The project's own demo database, migrated on a copy

**Run, on the PC.** The database the project's demo panel has run on since 0.1 (43 migrations, 7 servers of five games on 3 nodes, 5 accounts, 284 audit events, 13 backups, none of it
made for a test) was dumped read-only, restored into a throwaway Postgres, and this release's five migrations applied to the copy. They applied; every count was what it was; the four servers
that were `RUNNING` have their `readyAt` and the starting one and the two stopped have none, as the data migration says; and `prisma migrate diff` between the copy and the schema reported
no difference. The copy and the dump were deleted. **Not covered:** the demo itself was not upgraded, which is the owner's step at the cut (the demo runs as `next dev`, which tolerates a
database behind it; a production panel refuses one).

## Four hours, three servers, a month of data

**Run, on deb**, on the panel and agent built from the branch, with the database at the 1× size above (297 MB) and three Terraria servers running on the one node. A sampler wrote one
line a minute for four hours (251 lines, 20:46 to 00:46 UTC): what the panel, the poller, the database and the agent held, how long the last pass of the poller took, how long
`/api/health` took, the database's size and connections, and whether anything restarted.

| | Median | Lowest and highest | First hour, last hour |
| --- | --- | --- | --- |
| Panel's memory | 224 MiB | 216 to 248 | 229, 224 |
| Poller's memory | 193 MiB | 193 to 205 | 193, 194 |
| Database's memory | 189 MiB | 187 to 312 (the first quarter-hour after the load) | 310 (the load), 189 |
| Agent's memory | 145 MiB | 143 to 148 | 144, 146 |
| The poller's last pass | 39 ms | 29 to 95 | 40, 40 |
| `GET /api/health` | 5 ms | 4 to 10 | 5, 5 |
| Database connections | 8 | 8 to 9 | 8, 8 |

The database grew 1.1 MB in four hours (the poller's samples and the audit log; the poller pruned hourly). **No container restarted, no pass reported an error, no health answer took
100 ms.** What this does not show: days, because four hours cannot show a leak of a megabyte a day; a node that is under load or a server with players on it (the servers sat idle); more
than three servers or one node; and a panel under requests, which is the large-database measurement above and not this.

## A stranger following the README

**Run, once, on Ubuntu 22.04 under WSL2, with nothing on it**: no git, no Docker, no Caddy, the Windows tools taken off the `PATH` (a Docker Desktop's
`docker` answers to `command -v` inside a WSL distribution and is not Docker). The README's commands one after the other, answering the installer's
questions as it asked them in a terminal: `apt-get install -y git curl` (4 s), `curl -fsSL https://get.docker.com | sudo sh` (46 s, Docker 29.8.2),
`git clone` (4 s), and `sudo bash deploy/linux/install-panel.sh`, which asked six things (a domain: *no*; the address: Enter; whether to add Caddy's own
repository, since 22.04 has no package: *yes*; the owner's email and name; whether this machine runs game servers: *no*) and was done in 97 s, with the panel
answering at its address, the certificate checked, a temporary password and the next three things to do. **152 seconds from nothing to a sign-in page**,
and the doctor was the only thing that said anything was wrong: it read `/api/health answers 404`, because the README says `--branch stable`, there is no
such branch until the cut, a checkout of the branch is ahead of any release, so the installer pulled the published 0.8.1 image, which has no such route. The
installer had said so at stage 4 (that the checkout is not at a release tag, that the image it pulls is the 0.8.1 one, and that checking out that tag makes the
installer, the compose file and the docs match it); the doctor now says what the 404 means and what to do. **Not shown:** a person who does not know the commands (this followed them), a real VPS, a panel image that
matches its checkout (that is what the cut makes), and an install on a network with a proxy or no route to Docker's or Caddy's repositories.

## Panel and agent pairs, and a panel put back

Nine panel and agent pairs (0.4.1, 0.8.1 and the branch against 0.3.5, 0.8.1 and the branch) were run on a fresh database each; see
[nodes.md](nodes.md#panel-and-agent-versions). Putting a panel back from a dump on a machine it was not made on was run from deb to a clean WSL
distribution (`dump-panel.sh`, `restore-panel.sh`): the migration the dump lacked was applied, the key opened a stored token, and the undo worked.

## What was found, and where it went

Every defect above is in [the changelog](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md) under 0.9.0. The ones the matrix found
and nothing else had:

1. A real 0.4.1 panel upgraded to 0.9 read every running server as *unhealthy*.
2. The installer stopped on Ubuntu 22.04 for want of a package, after building.
3. The installer called an install behind NAT broken.
4. The installer replaced a newer build with an older published image and reported success.
5. `git pull` and `git checkout` aborted on a checkout the 0.4.1 installer had made.
6. A removed node left its port unit running until the next boot.
7. The README's first command failed on a clean Debian.
8. The release notes said no agent upgrade was needed from 0.4.0, and a real 0.3.5 agent was refused three times of three.

## What was not done

arm64; a machine with 1 GB or 3.8 GB; Ubuntu 26.04 as a VPS; M06 and M08; a second Linux node; a Windows node *Reached* by a panel; real screen
readers; Amazon S3 and R2; a long soak with a large database; a person following the README from nothing with no help. The last two are the ones
most worth doing before 1.0.
