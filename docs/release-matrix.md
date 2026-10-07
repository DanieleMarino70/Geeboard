# What was run before 0.9.0

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
5.0 s, the latter with the API's `INTERNAL` code and a reference (a database that is away is not told apart from a bug, which a client
may want to); the panel logged one `unexpected error` with its reference ("Connection terminated due to connection timeout") and the poller logged its node calls
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
production build (it ran against the dev server). Since then (P34): the axe baseline is empty (the progress bars have names, the games list is a list, every target is 24 px), the console, the
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

## A stranger following the README

**Run, once, on Ubuntu 22.04 under WSL2, with nothing on it**: no git, no Docker, no Caddy, the Windows tools taken off the `PATH` (a Docker Desktop's
`docker` answers to `command -v` inside a WSL distribution and is not Docker). The README's commands one after the other, answering the installer's
questions as it asked them in a terminal: `apt-get install -y git curl` (4 s), `curl -fsSL https://get.docker.com | sudo sh` (46 s, Docker 29.8.2),
`git clone` (4 s), and `sudo bash deploy/linux/install-panel.sh`, which asked six things (a domain: *no*; the address: Enter; whether to add Caddy's own
repository, since 22.04 has no package: *yes*; the owner's email and name; whether this machine runs game servers: *no*) and was done in 97 s, with the panel
answering at its address, the certificate checked, a temporary password and the next three things to do. **152 seconds from nothing to a sign-in page**,
and the doctor was the only thing that said anything was wrong: it read `/api/health answers 404`, because the README says `--branch stable`, there is no
such branch until the cut, a checkout of the branch is ahead of any release, so the installer pulled the published 0.8.1 image, which has no such route. The
installer had said so at stage 4 (*not at a release tag … git checkout v0.8.1 makes the installer, the compose file and the docs match that image*); the doctor
now says what the 404 means and what to do. **Not shown:** a person who does not know the commands (this followed them), a real VPS, a panel image that
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
