# Changelog

What changed between releases, written for whoever installs and runs Geeboard.
Anything that changes a command you type, a file you edit, a port you open or a
step you have to take on the way up is in here; the reasoning behind it is in
[docs/roadmap.md](docs/roadmap.md).

Versions are semantic, and Geeboard is on `0.x`: **the minor is where a
breaking change lands** until 1.0. A panel and an agent work together when they
speak the same **contract** — a number each carries, raised only when one could no
longer read the other — or, for an agent from 0.4.0 or before, which sends none,
when they share a release line (`0.1.x` with `0.1.y`). The panel checks it when a
node joins and shows it on the node's page. Every release below says, in one
line, what its agent contract is and whether an agent upgrade is needed. See
[docs/nodes.md](docs/nodes.md#panel-and-agent-versions).

Dates are ISO, newest first.

## [Unreleased] — 0.9.0

**The release that was run on machines.** 0.9.0 adds almost nothing a player would see. Before 1.0, the product was audited against its own code, on a clean Debian,
Ubuntu 22.04 and 24.04, a Windows PC and CI, and what the audit found was fixed and then run again: [what was run before 0.9.0](docs/release-matrix.md) is every
situation, what happened in it, and what was not done. The sections below are what changes for you, then what is safer, then what an upgrade does. Read **Upgrading**
before you run it: it dumps your database first, and the first `up -d` after it recreates the database container (its volume is untouched).
Five migrations, none of which drops or renames anything: `poller_state`, `server_operations`, `activity_server_index`, `manifest_definition` and `running_servers_were_ready` (the one that writes data: it marks the servers that were running as ready). Notifications gain
one event (*a server was left stopped*), which a channel you made before has to be ticked for.

**Agent contract: 1, unchanged. Every change to the agent below is additive. Upgrade your agents all the same: the first
item is a fix for something anyone who can reach a node's port could do.**

### What changes for you

- **A server's page and its REST routes now answer to one table.** The page's own buttons asked "are you an owner, an admin, or
  the person who owns this server?" and never asked what your role may do, so a **member who had been given a server could delete
  it, change its settings, run and pause its tasks and type into its console**, and a **moderator who owned one could delete it**
  — each of which the REST API already refused. They are refused on the page now, with the API's sentence ("You do not have
  permission to do that."), and the buttons are no longer drawn: a member sees Start, Stop and Restart on their own servers and
  no "Back up now"; a moderator sees no delete; a server's tabs list only the sections you may open. If you relied on a
  moderator deleting their own server, an owner or an admin does it now.
- **Pointing a server at a name under the DNS zone the panel manages is an owner's or an admin's.** A moderator who owned a server
  could retarget its address to any name the DNS provider covers, which writes (and deletes) records with the workspace's token.
  An address outside the zone is still theirs to set.
- **A server with the restart policy "Restart whenever it stops" comes back after the machine restarts, and a server that does
  not come back says why.** A reboot, or Docker restarting, stops every container on the machine; the agent reads that as an
  ordinary stop on purpose (a game that never handles the signal is killed by the grace period, and that is not a crash), so
  after every reboot every server was down, whatever its policy said, and nothing on its page said why. The panel now starts
  an `ALWAYS` server that stopped without its asking, at once, and without using up the budget a crash loop needs (two reboots
  in an afternoon are not one). A server whose policy does not start it again (`ON_FAILURE`, `NEVER`) stays stopped, and its
  page says why it is down, what the panel knows about the cause and no more, and what to do. What it knows is a signal in
  the exit code (Docker or the machine), or the node's other servers stopping in the same pass ("points at the machine or
  Docker restarting"); a lone clean exit says nothing is known, because a Minecraft server that Docker stops exits with the
  same code 0 as one that quit. A stop you ask the panel for, including `stop` typed at the console from the panel, is never
  one of these.
- **A new notification: *a server was left stopped*.** One message for a server nobody asked to stop that its policy leaves
  down, several at once as one, with the same sentence the server's page has. A channel made from now on has it ticked; a channel
  made before keeps what it had, so **tick it on the channels that should hear about it** (Settings → Notifications). The webhook
  event is `server.left.stopped`. After a hard power loss Docker reports the servers that were running as exited with 255, which
  the panel reads as a crash, so an `ON_FAILURE` server also starts again then, by the crash path it already had.
- **Signing in, and getting back in, work on a Docker install and on a phone.** Seven messages told a panel installed by
  `install-panel.sh` to run `npm run admin:recover`, a script that exists only in a development checkout, so the one sentence
  a person reads when the one-day temporary password has run out named a command they did not have. They now name the one that
  exists for the way the panel was installed (`docker compose -f deploy/panel/docker-compose.yml run --rm panel recover`, with
  `--email` when the panel knows whose it is), shown apart from the sentence so it can be copied whole on a phone, and the
  sign-in page says how an owner who is locked out gets in, or, on a panel with no owner, how to make the first. The second
  sign-in step asked a phone for a numeric keypad, which has no letters, for a field that also takes a recovery code, and
  refused `123 456`, the way the authenticator app shows the code, after spending one of five attempts on it; it now asks for
  the text keyboard and takes the code however it is grouped. A link to a page (a message that says a server crashed) now ends
  on that page after sign-in and its second step instead of on the dashboard; a session that ended says so; the button that
  sets a password says what it does, and the sign-in after it has the address filled in; a failed sign-in no longer empties it.
  The installer's closing words stop saying "the temporary password above" when no owner was made, and say how to get a new one
  when there already was.
- **Ten wrong passwords typed by somebody else no longer lock you out of your own account, and an API key lives a year.** The
  sign-in limit counted ten tries a quarter hour per address from anywhere, so anybody who knew yours could lock you out for as long
  as they kept typing; it counts ten per address from each *source* now, thirty per source across addresses, and sixty per address
  over every source as the ceiling over many. The source is the last `X-Forwarded-For` entry, the one the proxy in front of the
  panel wrote, and not the first, which the client chooses: `GEEBOARD_TRUSTED_PROXIES` in `deploy/panel/.env` is how many proxies there
  are (1, which is the Caddy the installer sets up and the nginx block in the docs; **0 if you reach the panel directly**, where
  no header is believed and everybody is one source). The nginx block in the docs now writes `$remote_addr`, which replaces what
  a client sent; the old line works too. A key made from now on stops working **a year** after it is made (the API keys page shows
  the date; keys made before this release have none, as before), and **all of an account's keys are revoked** when an admin resets
  its password, when an owner runs `recover`, and by **Sign out other devices**, which says so: a key outlives the session that
  made it, and each of those exists for a password or a session in the wrong hands. Make a new key from the API keys page.
- **The Linux installer says what it checked, and refuses what would have failed three stages later.** Its last check ran on the machine
  itself and was described as "from outside", so on a provider that binds the public address on the network card (OVH, Hetzner,
  DigitalOcean) "HTTPS answering" meant nothing about the firewall; it now says it was asked from this machine, names the firewall it found
  (ufw, firewalld, an iptables policy that drops) with the command that opens 80 and 443, says when the machine is behind NAT, and closes
  by asking you to open the address from another machine. **`--check`**, on the panel's installer and on the node's, reports what the
  machine is (Docker and Compose and their flavour, whether Docker starts at boot, memory, disk, architecture, the clock, SELinux, the ports
  and who holds them, the firewall) and changes nothing; every normal run prints the same lines. **Refused before anything is changed:**
  a Docker installed as a snap, Compose v1, a port 80 or 443 that something else holds (named, where Caddy used to fail to start while the
  installer said "HTTPS active"), and, for a node, an agent port that something else holds (Wings and AMP like 8080). A Caddy that is not
  running after its configuration was written is an error with its own log lines. **A Caddyfile that serves files, runs PHP, redirects or
  imports is left alone** (the site block is printed); it used to be replaced unless it had a `reverse_proxy` line, and a static site on the
  same Caddy lost its configuration at the reload. **An IPv6 address works for `--ip`**: bracketed once (`PANEL_URL=https://[2001:db8::1]`),
  where a bare one built a URL Node refuses; `is_ipv6` no longer accepts `:` and `1:2`. A domain's A and AAAA records are both read, and an
  AAAA that points at another server, which makes Let's Encrypt fail while the A record is right, is said before the certificate is asked for.
  Package-manager failures keep their last lines and wait for a new machine's dpkg lock; a failed pull is tried three times, a copy of the image
  already on the machine is used before a build, and a build says what it needs; a failed `compose up` ends in a sentence. A node join the panel
  refuses says why; a panel that does not answer is found before the image is downloaded. Everything either installer prints is also written,
  without colours, to `/var/log/geeboard-install.log` (root only), its temporary files live in a directory of their own removed however it ends,
  `--domain` with no value is an error and not a silent exit, and the agent's unit starts the `docker` that was found, with `--init` and a capped
  log. `shellcheck -S warning` is clean on every script in `deploy/` and CI keeps it so.
- **A node's port is closed to everybody but the panel, and the container firewall no longer cuts the panel off its own node.** The agent
  listens on every address, and one token stands between that port and every container on the machine; on a VPS it was public until
  somebody remembered a firewall. `install.sh` now closes it (`deploy/linux/agent-port.sh`: loopback, the panel's address, and Docker's
  networks when the panel is on this machine) with ufw if that is active, firewalld if it is running, and otherwise iptables in a chain of its
  own, IPv4 and IPv6, kept across a reboot by `geeboard-agent-port.service`; it then asks the panel whether it can still reach the node, and says how
  to undo it. **`--no-firewall` leaves it as it was.** The rule holds the addresses the panel's name resolved to when the installer ran, so a panel that
  moves needs the node installer run again (a node on the panel's own machine does not). Measured from another machine: open before, refused after;
  the panel on the same machine kept reaching its node, and both survived a reboot. **The channel is still plain http with one token:** the installer and
  the *Add a node* dialog now say so when the address is public, and the way to deal with it is a private network (WireGuard, Tailscale) on both ends
  (docs/security.md#the-panel-agent-channel); TLS on the agent is on the roadmap after 1.0. `container-firewall.sh add` (community games) rejected
  TCP 22 and 8080 from every Docker bridge, and the panel is a container on one, calling its node at the LAN address, so on a panel-and-node machine it
  made the node unreachable. It now lets the panel's network through, `remove` takes away every rule with its comment whatever ports it was added
  with, `install-service` keeps the rules across a reboot and a restart of Docker, and `refresh` puts them back after the panel's network is made again.
  **The panel's network now has a bridge with a name of its own (`gb-panel`)**, because Docker's `br-<id>` changes with the network and a rule that names it
  stops matching; **the first upgrade to this release takes the panel's stack down once, with its data, and brings it up again** (a few seconds more than the upgrade
  already costs) so that compose can give the network its name. `uninstall.sh` no longer uninstalls when asked for `--help`, `--purge` lists what it deletes,
  refuses while a game server's container exists and asks for a word, and the new `uninstall-panel.sh` takes the panel down keeping its data (`--volumes`
  deletes the database after a dump and a typed phrase). Moving the panel and changing its address are written down
  (docs/production.md#taking-it-down-starting-over-moving-it).
- **A Windows PC can join a panel that is reached at an address, and no node needs a file copied by hand.** A panel without a domain name has a
  certificate signed by an authority of its own, and a node refused it: on Linux until somebody copied `/etc/geeboard/panel-ca.crt` over, on Windows
  for good (the installer had no option for it, the dialog hid the note on the PowerShell tab, and the agent's message named a Linux flag; the 0.3.5 notes
  recorded it as found and unfixed). The command the panel writes now carries the authority's SHA-256 fingerprint (`--panel-ca 'sha256:…'`,
  `-PanelCa 'sha256:…'`), on both tabs. The node asks the panel for the authority (`GET /api/v1/panel-ca`, public: the node has no token yet) over a
  connection it does not trust, **keeps it only if its fingerprint is the one in the command**, and checks that the panel's own certificate is signed by
  it; a mismatch is thrown away with both fingerprints in the sentence. The Windows installer keeps it beside `agent.json` and the task's wrapper gives it
  to the agent at every start, so an upgrade keeps it. **A panel installed before this has to be run through `install-panel.sh` once more** to learn its
  own authority (`PANEL_CA_B64` in `.env`; the panel starts once more to know it, and a second run changes nothing); until then the command is what it
  was, and the dialog says so. Measured: the dialog's PowerShell command, pasted into Windows PowerShell 5.1 against the panel on a clean Debian VPS,
  registered the PC and its heartbeats kept arriving every 15 s; the same install run again with no arguments kept the authority.
  Also on Windows: a command pasted into Command Prompt (which keeps the single quotes written for PowerShell) is taken as it was meant, with a note; the
  installer no longer prints the registration token (npm echoed the command it ran); `GEEBOARD_AGENT_FILE` moves the settings, the panel's authority and
  the wrapper together, and `-TaskName` and `-Port` keep a second node on one PC apart from the first; the uninstall command it prints, and every Windows
  command in the docs, is the `powershell -ExecutionPolicy Bypass -File …` form a fresh Windows will run; and `agent.json` with a byte order mark (which
  Notepad and `Set-Content -Encoding utf8` write) is read. **Not shown here:** the PC reaching "Reached" through the VPS panel (the PC is behind a
  router and the test machine is on the internet), that is, the panel calling the PC back, which this change does not touch.
- **The Windows agent has a log, is restarted when it stops, and an old one cannot be left behind.** The task ran a hidden PowerShell whose wrapper was
  `& npm.cmd start` with no redirection, so every message and doc page that said "read the agent's log" pointed at a window nobody could open;
  Task Scheduler's own restart gave up after ten tries without a word; a re-run stopped the task but not the `node.exe` under it (or one started by hand),
  so the new agent died of the taken port while the old one, with the previous token, kept answering `/health` and the installer said all was well. Now
  `agent.log` beside `agent.json` (UTC, rotated at 5 MB) has what the agent says and a line each time it starts and stops, with the exit code; the wrapper
  starts it again after 5 s, longer each time it dies at once up to five minutes, and never gives up, except for exit code 78 (another agent holds its port),
  where it writes that and stops. `install-agent.ps1` stops this node's agent first (the task, its wrapper, the listener on this node's port; a second node
  on the PC has its own wrapper and port and is left alone), names and refuses a program that is not an agent, allows the task on battery (it was
  refused to start on battery and stopped when unplugged), then waits for `/version` and says so when what answers is not this checkout's version. `install-node.ps1`
  reads the log for the same three verdicts `install.sh` reads out of the journal, reads the port from `agent.json` and no longer assumes 8080, says "Docker Desktop
  is not running" in three lines under Windows PowerShell 5.1 (it printed docker's own error text), says what to do in each way a join can fail and not only
  "make a new token", and finishes a half-done install with "run this again with no arguments". The wrapper survives `C:\Users\O'Brien\…` and a path with a letter that is
  not ASCII (an apostrophe ended its string and the agent never started), and is written with a byte order mark whichever PowerShell ran the installer. The uninstaller
  no longer ends every agent on the PC whose command line says `index.ts`: only this node's. Measured on the PC, beside the real agents: killing the agent's
  `node.exe` brought it back in 13 s with the exit code in the log; an agent started by hand was found and stopped by the installer and `/version` matched the checkout;
  a program on the port was named by pid and left running, and the task started on that port stopped with exit code 78; Docker unreachable gave the three lines; a checkout
  under an apostrophe started. **Not shown:** battery and sleep (a desktop never does either).
- **Every operation on a server has an owner, and one that dies gives the server back.** An update, a rebuild, a restore, a settings rebuild, a rollback, a move or a backup put the
  server in a state the platform owns and cleared it only by reaching its last line; nothing claimed the server first (two backups started together left it "Backing up" for ever, and
  a delete, a restart or a restore could begin under an update: the domain's guards existed and nothing called them), nothing recorded that anybody was still working, and the poller
  does not look at a server in those states, so one cut short stayed "Updating" for ever and unwatched, with, for one window of a rebuild, no way out in the page. Each now **claims
  the server in one statement** and a second is refused with what has it and for how long ("Busy: a backup has been running for 1 s."); **Delete, Start, Stop and Restart are refused
  while one holds it** (a nightly restart task no longer lands in the middle of the nightly backup); the process that holds a server writes a beat every thirty seconds; **a panel or
  a poller that starts gives back what the last one of its kind held**, and the poller gives back any held server that has been silent for five minutes: a backup's server goes back to
  what it was (the backup marked failed), anything else is in ERROR with a sentence that says what happened and what to do, in the state the page already offers a rebuild for, with a
  `server.operation.interrupted` audit line. A rebuild now claims before it stops the server (the stop is its longest quiet stretch), and a settings change that cannot be applied
  because the server is busy puts the old values back instead of leaving them saved. Also: a create whose node token cannot be read, or whose settings cannot be rendered, takes its row
  with it instead of leaving a stopped server that holds a port; a failed automatic restart and a failed unattended restart, command or broadcast leave `server.recovery.failed` and
  `task.failed` lines with the reason (they left nothing); the poller starts no new scheduled task after it is told to stop, and its wait between passes ends at once, so an idle one
  exits in well under a second; and the agent's create and destroy are safe to ask for again: a create for a server that already has a container replaces what the first left (it was a
  409, with the container possibly running and holding the port), and destroy by a server id reaches its container, and says "no data was removed" when there was none. `api.md` says what
  the API does. **A migration** (five columns on `servers`). Measured on the VPS with a real Minecraft server: two backups a second apart: the first complete, the second "Busy", the
  server back to running, one backup row; a delete and a start during a rebuild refused with the reason.
- **The poller stays awake: a night of backups, a node that does not answer and a wrong key no longer stop it.** A pass walked its nodes and their servers one call after another
  (about six calls a running server, and the agent's `stats` waited two seconds in Docker for a second frame: **1.0 to 2.0 s a call, measured on a 6-core VPS, against 2 ms with
  `one-shot`**), ran every scheduled task inside itself until the last had finished, and gave every new server's backup the same minute, `0 3 * * *`: a night of backups was a night
  with no samples, no crashed server restarted and no notification dispatched (on the VPS, three servers of 1.5 GB: **a longest gap of 157 to 165 s in each server's samples**, six
  passes of 5.3 s). One node token the key could not open ended the whole pass, the tasks and the notifications with `poll failed detail="Unsupported state or unable to authenticate
  data"`, no node named. Now: **the nodes are read together and the servers of a node four at a time through one gate of eight** (`POLL_CONCURRENCY`); a call to a node that names
  no limit of its own gives up after five seconds (`POLL_CALL_TIMEOUT_MS`), where a silent node cost ten in front of every node after it, and **a node not read within 45 s
  (`POLL_NODE_DEADLINE_MS`) is left to finish and not asked again until it has**; the poll line says which node was slowest. **The agent reads `stats` at once** and takes CPU from
  the difference with its reading of the pass before (an average over about a pass; the first reading of a container, one after it started again and one after two minutes of
  silence are taken the old way, once; two callers at once share one answer): 5 ms a reading, the same 49 % as `docker stats` for a container held to half a core. **Scheduled tasks
  run beside the pass**, two at a time and one to a node, each **claimed first** by moving its next run on in one statement that only one runner wins, each judged late by the clock of
  its own turn, and a poller told to stop lets the ones that began finish; **a new server's nightly backup is at a minute of its own between 03:00 and 03:45**, from its id (existing
  tasks keep theirs). **A server whose backup holds it is still sampled**, so the chart shows the backup instead of a flat gap (state, health and players are left alone), and the
  poller writes a server's state **only if it is still in the state the pass read it in**, which an operation that began in the minute a pass takes had its state overwritten by. **A
  token that cannot be opened is one node's line** ("`SECRETS_KEY is not the key these secrets were sealed with`", the node named, once per change and on the Nodes page), the node
  is treated as not reached and the others are read as always; the panel and the poller **say at start, in one line, how many stored secrets do not open** and where
  (`N stored secrets do not open with SECRETS_KEY (node tokens: 2, two-factor secrets: 1)`), an action on such a node says the sentence, with what to do, instead of "Something went
  wrong" (new code `SECRETS_UNREADABLE`). Also: a DNS record that keeps failing for the same reason writes **one** audit row, not one every five minutes for each of its three records;
  an expression of a community game is tried three times before it is called too slow (one stall on a busy machine broke a good one for the life of the process, and its game stopped
  counting players), and the log says when one is; the size of a world is measured beside the pass, two at a time, spread over the servers, with the walk on the agent asking about
  thirty-two files at a time, and a walk that failed is waited out for five minutes instead of being tried again in every pass; a closed session is looked for only when a server
  stopped; the first run of the scheduler's system user no longer fails when two workers make it at once. Two repairs of the previous entry, found by running the node suites
  against it: **a move failed every time** ("Busy: a move has been running for 41 s"), because the backup it takes on the way asked to claim a server the move already held
  (it is now a step of the move and takes nothing); and a create on one agent took another agent's container for the same server, on an engine they share, for a leftover of its
  own (a move's old workload was gone before the switch and its world left behind): it now replaces a leftover only by the name it is about to take. **A migration** (an index on `activity_events.serverId`: deleting a server
  scanned the whole audit log twice, 98 ms each at a million events for a server with a hundred of them, 2.6 ms with it). Measured: **a hundred servers on ten nodes, each call 30
  ms: 3.6 s a pass** (23 s one server at a time; 29 s with an agent that still waits two seconds in `stats`); the VPS batch again, with the new poller and agent: **the longest gap in
  each server's samples is 15 s, 17 passes of 0.31 s, no node event, the three backups complete**; the 7-day analytics page over 4 million samples is 1.1 s and 0.5 s of database
  (the `at` index does the 24-hour one in 82 ms; 7 and 30 days need a rollup, not done).
- **`doctor.sh` for Linux, the panel-by-agent table, the supply chain read, and a cron's first run on the reader's clock.** `deploy/linux/doctor.sh` is what `doctor.ps1` is on Windows: it looks at
  the machine, Docker, the panel (containers, `/api/health` against the checkout's release and migrations, the public address, the nightly dump and its age) and the node (the agent's
  unit and the ones that close its port, what listens, `/version`'s release and contract, whether the panel answers from there), changes nothing, prints no secret, and exits 1 with the command
  for each thing it found. Run on the test VPS it said two true things (its database is ahead of its checkout; no nightly dump) and recognised Caddy's own authority on an address as an answer;
  on the WSL panel it flagged the drill's made-up address. `docs/nodes.md` has **the table of which agent works with which panel** (0.4.1, 0.8.1, 0.9.0 against agents from 0.3.2 to 0.9.0), and
  `test/nodes-versions-docs.test.ts` computes every cell from the rule. **`scripts/licenses.mjs`** (run by CI) counts the licenses of what both packages ship and fails on one that is neither
  permissive nor named with its reason (the LGPL libvips binaries sharp carries, `elkjs` via Prisma Studio, `caniuse-lite`'s CC-BY, and `seq-queue`, which names no license and is MIT); and
  `scripts/check-repo.mjs` now fails on a Dockerfile `FROM` or a compose `image:` that is somebody else's and not pinned by digest — the laptop compose file's Postgres was the one that was not.
  The scheduler's editor says when the first run is on the reader's clock beside the UTC it computes in.
- **A panel that is lost can be put back, and a join password typed at the console is not kept in the audit log.** The panel's database is where the accounts, the nodes, the servers, the schedules
  and every record of a backup live, and `.env` holds the key every stored node token, bucket key and two-factor secret is sealed with; the only dump there was, was the one an upgrade takes, so
  a panel that was never upgraded had none, and a dump restored beside another key opens nothing. **`install-panel.sh` now installs a systemd timer, `geeboard-dump.timer`, that runs
  `deploy/linux/dump-panel.sh` every night** (a dump read back with `pg_restore --list` before it is believed, the `.env` copied beside it, the last 14 kept, the dumps an upgrade took never
  touched; `--no-nightly-dump` leaves it out; `uninstall-panel.sh` removes the timer and keeps the dumps), and **`deploy/linux/restore-panel.sh --dump … --env …`** puts a dump back on this
  machine or a new one: it reads the dump back, dumps what is there now with this machine's `.env`, replaces the database, applies the migrations the dump lacks, and only then puts the dump's
  `SECRETS_KEY` and `SESSION_SECRET` in (never `POSTGRES_PASSWORD` or `PANEL_URL`, which are the new machine's), and prints the commands that undo it. Proved as a drill: a dump taken on the test VPS
  by the new script (160 objects), carried to a Debian-clean Ubuntu 24.04 (WSL2) where the panel had been installed from this tree, restored there — the accounts, the node and 221 audit rows
  came back, one migration the dump lacked was applied, and `rekey --dry-run` opened the node's sealed token with the restored key — and then undone with the printed commands. The nodes
  call the address they were joined with: a new panel at another address has to have each node joined again, which `docs/upgrading.md` says. And **a console command is recorded without the value
  of any secret setting the server holds** (`password hunter2` is kept as `password [hidden]`; the game still receives what was typed): the audit log is searchable and exportable by every account
  that may read commands, and a join password set from the console was kept in it in clear, for good. `verify:console` proves it through a real agent. The README and the install page now say a
  new Debian or Ubuntu has neither git nor Docker, which the first run of the README on a clean machine found (`git: command not found`).
- **What a release is made of is built and run on every push, and the scripts that drive real containers run weekly on a runner.** The agent image was first built when a tag was pushed, the
  panel image was built and never started, the installers were parsed and never run, PowerShell was not parsed at all, and the Docker-backed scripts ran by hand on a PC (one of them rotted for
  three releases). CI now builds the agent image, starts it with the engine's socket and checks that `/version` says the release and the contract the checkout says; **runs
  `install-panel.sh --yes --build` on a clean runner twice (the upgrade and the repair), restarts the stack, asks `/api/health` and `/sign-in`, and runs `uninstall-panel.sh`**, on Ubuntu 24.04
  and, allowed to fail, 26.04; parses every `.ps1` under **Windows PowerShell 5.1** and runs `doctor.ps1` to its last line on a runner with no agent; and reads the compose file with an
  environment. `full.yml` runs `verify:all` (34 of 35 scripts passed on the first run on a runner: the Docker group, SeaweedFS-backed backups included, in 20 minutes) every Sunday and on
  request, leaving out `verify:mods` and `verify:a11y`. Shown to fail on injected defects, on a branch pushed for the purpose and deleted: a script recorded 100644, a `.ps1` with an unclosed
  brace and an edited old migration each failed the job that should name it. The first full run found `verify:pull` asking for a reading in the middle of a download, which a runner's line
  never gives (it pulls 80 MB in under five seconds); it now asks that the layers were counted and the bytes never went down. `verify:all --skip a,b` leaves scripts out. Not done: the
  community repository's weekly check against the latest release, and `verify:mods` in CI.
- **A release cannot publish a lie: the order is a script's, every file that says a version is held to the others, and the docs wait for the image.** Four version numbers were
  spent in three days (0.5.0, 0.6.0, 0.8.0, and a moved 0.3.5): the docs site, `main` and the tag left in one push, before CI had answered and before any image existed, so the live Upgrade
  page named `geeboard-panel:0.8.0` for about 63 hours with no such image; the cut edited about eight files by hand and the tag was compared with two; and a tag push runs the workflow files
  as they were at the tagged commit, so a CI fix could not reach a tag. **`scripts/cut.mjs`**: `bump X.Y.Z` writes what is mechanical (both packages, the two version fields of both lock files by text and
  not through npm, which prunes entries on Windows, every image tag and checkout in the pages a person follows, the changelog's heading, date and link, the pins of the migrations the release
  ships) and then names what is left for a person; `check` asks before the tag whether the tree is true, clean, pushed to `main`, green in CI on that exact commit, with the tag unused
  here and on origin and no migration that shipped edited since the last release tag, and runs the docs build and link check; `after` waits for the Release run and reads what it published from
  outside, anonymously (both images under three tags, one digest each, built from the tagged commit, the draft's notes, `stable` at the tag, the docs site); `.githooks/pre-push` runs `check
  --pushing` for any `v*` tag about to leave. **`web/test/release-consistency.test.ts`** runs the same checks on the tree on every push and, with one thing made wrong each, on copies
  of it: a lock file, an agent version, an image tag or a checkout in a page, a clone of the default branch, a dropped changelog link, a date out of order, a contract the changelog and the
  code disagree on — each named by file; and `bump` is shown to leave a tree that is true but for the prose. **`release.yml`**: a tag must be on `main` and agree everywhere (`cut.mjs verify`) and
  have notes; both images are built, pushed as `X.Y.Z-<sha>`, and only when both exist get `X.Y.Z`, `X.Y` and `latest` (a pre-release gets only its own name, and `latest` goes only to the
  highest release); the draft is created once, `--verify-tag`, with no empty notes; then `stable` moves to the tag. **By hand, on a change to the file, and weekly, it is a rehearsal** that builds
  both images and publishes nothing; CI reads every workflow with actionlint. **`docs.yml`** publishes only when `geeboard-panel:<the version>` can be pulled (otherwise the previous site stays and the
  run says why), and after a successful tag Release publishes from the released commit. **The install instructions clone `--branch stable`**, the last published release, and no longer `main`, which is
  ahead of the images between releases: `git pull` is an upgrade to a release and never to work in progress. The published images are for x64, and the page says so. A migration after a release
  that drops, renames or tightens fails a test (the rule in `docs/extending.md`); the changelog's links for 0.6.0 to 0.8.1 are back. `docs/development.md` has "Releasing", the routine with the reasons.
  Not done: attestations and signing (later, as decided), a dispatch that recovers a burned tag (a number is burned, and the next one is taken), and a `stable` branch that has not been created
  yet (`git push origin v0.8.1^{commit}:refs/heads/stable`, once, by the cut).
- **The 1.0 sentence is written down with its edges, and tests hold the page to the code.** The brief declares 1.0 when adding a game, a node, a provider or a storage needs no architecture
  change; the sentence was true for some of them and false for others, and `docs/` had one recipe of ten and eight statements the code contradicted (`DockerRuntime` "is the only file that knows
  the word image" — it is in 53 source files, 262 times; "adding a game is a definition and a registry line, nothing else"; a third DNS provider "is an entry and not a new branch in a dozen
  files" — nine places the compiler lists and a few it does not; authorization "through `can()` rather than a role comparison" — 35 comparisons in 17 files, of two kinds; the notifier's rows
  "cannot silently stop being one" — a renamed action string does). **`docs/extending.md`** has the sentence, the edge of it (a store that is not S3-compatible, an RCON-only console, a
  setting format the panel cannot write, an install that is not an image, mods for a second game, a runtime other than Docker, an architecture other than x64), the ten recipes with what is
  forced, what a test holds and what is silent, and today's lists of games, providers, capabilities, targets, probes, protocols, sources and scopes; the same sentence is in the roadmap, word for word,
  and the eight statements are corrected. **From 1.0 the API and both webhooks only grow inside a major version** (a minor release adds fields, routes, events and enumeration values and a client
  ignores what it does not know; a code, a documented field and its type do not change), **the DNS body and the notification payload carry `version: 1`** (the example receiver ignores a field it
  does not know, reads none as 1 and refuses a version it does not know), **the agent reports `features: []` in `GET /version`, its registration and every heartbeat** (additive, contract
  unchanged; the panel stores nothing until a feature exists to ask for), and **a release adds to the database and the one after it removes**: `test/migrations.test.ts` pins the 43 migrations
  of v0.8.1 by hash (a migration that shipped cannot be edited) and fails a newer one that drops, renames or tightens. Held by `test/extending-docs.test.ts` (every path and every `path#Name` the
  page writes exists; its twelve lists equal the code's; the sentence equals the roadmap's; each check is shown to fail), `test/migrations.test.ts`, and a new guard in
  `test/extension-guards.test.ts`: every audit action the notifier reads has a producer, which a rename at the producer used to break silently. Not done, and said on the page: the notification
  channel, the probe, the query protocol, the target and the version source are still not tables the compiler walks; the four copy strings that name Zomboid as the only game with mods are not derived.
- **The API page says what the API does, and a test holds the two together.** `docs/api.md` listed three codes no route sends (`GAME_VERSION_NOT_FOUND`, `GAME_VERSION_UNSUPPORTED`,
  `VERSION_PROVIDER_FAILED`), left out two that are sent (`MOD_PROVIDER_FAILED`, `MOD_KEY_REFUSED`), showed a refusal body no route produces, and was silent on `GET /api/v1/panel-ca`. The
  routes chose a code by reading the operation's sentence (`/locked/`, `/No off-site storage/`, `/Name does not match/`, and for files `/no agent attached/`, `/permission/`), so a node that
  did not answer arrived as a 422 refusal and a path outside the server's directory never as the 403 the page promised. **An operation's failure now carries its `code` and `details`**, set where it
  went wrong: a node that is not there is `NODE_NOT_FOUND` (404), a node that is draining or not approved `NODE_UNAVAILABLE` with `details.reason`, no room `CAPACITY_EXHAUSTED` with the resource and
  both numbers, a node that cannot run the game `NODE_INCOMPATIBLE` with `details.missing` (capability ids) and `details.reasons`, an address or a name taken `CONFLICT`, a failed install
  `SERVER_INSTALLATION_FAILED` with the step, a wrong typed name `VALIDATION_FAILED`; the file routes' codes come from the node's answer, and a traversal is `FORBIDDEN`. Found on the way:
  **`POST /backups/:id/restore` read `{"into": ""}`, `{"into": null}` and `{"into": 123}` as "no `into`" and restored over the server the backup came from** — a script with an unset variable
  replaced the live world with an older one; a present `into` or `inPlace` that is not valid is `VALIDATION_FAILED` now. A cleanup task took only `7`, so the documented `keep 7` was refused
  (and a task made in the panel, stored as `keep 14`, failed validation when renamed by key): both are read. `?state=` that is not a state was a 500 from the database's enum and is a 400
  that says which are; `?range=toString` was a function on every object and is a 400; `GET /backups` took its first five hundred and then dropped what the caller may not read, so a
  member's older backups vanished behind five hundred newer ones of other people's — the filter is in the query; the game shape carries the fields a form needs (`help`, `secret`,
  `fixedAfterCreation`, `lines`, `minLength`, `maxLength`, `pattern`, `requiredWhen`, `mustNotContain`, `fromFiles`); `GET /api/v1/panel-ca`'s 404 was `{ "error" }`, the one body in `/api/v1`
  that was not `{ code, message }`. The page now has the rate-limit budgets as a table (they are shared by every route with the number, and `Retry-After` is not sent), what every answer
  carries (`x-request-id`, `cache-control: no-store`), the creation refusals as a table, the 2 MB text-file rule (over it nothing is sent, it is not cut), the label of `metrics:read` says it is
  `server.read`, and what the API does not do is listed in `api.md`, `limitations.md` and `what-works.md`. **`test/api-docs.test.ts`** reads the handlers and the page: a handler the page
  does not name, a code in its table nothing sends, and a code a route can send that the table does not list each fail (and the checks are shown to fail on a bad page). **`verify:api` called
  39 of 63 handlers while the page said it called every route; it calls all 63 now (87 checks to 127), and its last section fails on the next one added without a call** — which found
  `DELETE …/mods/:workshopId` on its first run, and a regression of this very change (`PUT …/files/content` without an agent answered 422).
- **A server is born with its game, a secret column cannot be forgotten by `rekey`, a platform no game accepts is refused by name, and a game an owner approved cannot be dropped by a stricter rule.**
  A server is linked to its game's definition through the catalog, and everything that depends on the game (the command that stops it, the one that saves it before a backup, its health check,
  its settings, its address's SRV record) is found through that link; the catalog was brought up to the definitions only when the poller's six-hour clock ran out, so after a release that adds a
  game or a version the first servers made were born without any of it (stopped by signal, which for Terraria loses everything since the last autosave; backed up unflushed; never judged; told they
  "predate the catalog"). **Creating a server now brings the catalog up to the definitions first, offline, when a row is missing; the poller does the same at every pass, whatever the age of the last
  sync; `migrate` already did after the migrations.** `rekey` knew its encrypted columns from a list inside a function: **`SEALED_COLUMNS` is the one table, its loaders are keyed by it, and a test
  reads `schema.prisma` for every column documented as encrypted and `src/lib` for every `encryptSecret(` and fails on one that is not in it**. A node that reported `armv7l`, `riscv64` or
  `freebsd` was read as "has not reported one yet" and let through to fail at the image pull: **it is refused by name now** (*Terraria needs x64, not armv7l*). **A community game that fails a rule a
  later release adds**, which used to leave the registry under its servers, **is served as it was approved** (the definition it last validated into is kept beside its manifest, in a new nullable
  column, `20261008100000_manifest_definition`, which the panel works without until it is applied), is not offered for new servers, and says so on its servers' pages; a game with no server is
  skipped as before. The definition audit now refuses a JSON target and a download install, as the manifest does; the panel's outbound identity is one `Geeboard/<version> (+<project>)`
  where four clients wrote four (one claiming 0.1 and an address that is not the project's). Held by tests that read both sides: every file in `definitions/` is registered or parked and audited,
  the measured capabilities and the reserved ports against the agent's source, and the API scopes against the permission table and `docs/api.md`. `npm run verify:extension` (new): with Terraria's
  catalog rows deleted, and then the game itself, a server created is linked and its stop is the game's command; an offline pass closes a missing game; three platforms are refused by name; an
  approved game that fails a later rule keeps serving, flagged, and a game with no server is skipped.
- **The first server on a small machine can be created, and the panel says what it needs when it cannot.** The wizard preselected Minecraft at its own defaults (8 GB and three cores) whatever
  the node was: on the 3.8 GB, two-core VPS the documented proofs ran on, which the agent counts as a 3 GB node with 200% of CPU, only Terraria's 2 GB fit, so every other game's first screen asked
  for a server the node could not take, the node's button read "no room for this one", the refusal was "Every node: memory" with the numbers dropped, and the way forward it offered was the box that
  overcommits. Now **the resources start fitted to the node** (lowered to what is uncommitted, in the sliders' steps, never under what the game asks for, and said: *Fitted to vps: memory 3 GB
  instead of 8 GB, CPU 200% instead of 300%*), they follow a change of node or game while they are still the fitted ones, and a game whose floor does not fit says so with the numbers (*the game asks
  for at least 6 GB, and vps has 3 GB uncommitted*) in the wizard, the placement card and the create's refusal (*vps has 3 of its 3 GB of memory not yet promised to a server, and this one asks for 6
  GB*, where an empty node said "0 of 3 GB is already committed to 0 servers"). **The address is not a name nobody owns**: with no provider and no server yet it started as `server.ashfold.gg`, the
  sample workspace's domain, so the first server of every real install was offered it; it is now the node's address or empty, with its own refusal, and a server reached by IP no longer makes
  `0.113.9` the workspace's domain. A server's page says **Players connect with** the name, or the node's address before the name points there, each with Copy. **With no node approved,
  `/servers/new` says "Add a node first"** (and which machine waits for approval) instead of three steps ending at an empty list, and the dashboard, Servers and per-server empty states lead with
  **Add a node**. **The Add-a-node command brings its own checkout at the panel's release** (`git clone --branch v0.9.0 --depth 1 …`), so the agent the installer pulls is the one this panel
  expects, with a link to the guide; the approval card says the machine's hostname, the address the registration came from and the token that was spent. And the invented figures went: "about five
  players to a gigabyte", "a world grows about a gigabyte a week", "about 40 seconds" now say what the game asks for or nothing; a completed stop says "Stopped", not "Stop requested"; the
  files page no longer says a file over 2 MB "opens read-only" and then shows nothing; and a second drop while a queue is uploading waits instead of starting a second queue against the first.
  Measured against a workspace that is exactly that machine (`npm run verify:firsthour`): Minecraft Java and Bedrock, Terraria and Valheim are created at the fitted defaults, Zomboid is refused with the
  node's numbers, and Minecraft at its own defaults, as the wizard used to start it, is refused saying so; in Chrome the wizard starts at 3 GB, 200% and 40 GB with the notice, the review step's
  Create is enabled, no step of it says `ashfold.gg`, and with no node it says Add a node first.
- **Every piece of text reaches 4.5:1 in both themes, a field has an edge you can see, and the light theme's primary button is readable.** The audit measured it: in the light theme the
  primary button's label was 4.01:1 on its fill, text in the accent, success and warning colours 3.5 to 4.2:1 on a card and on its own tint (3.5 on a notice on the page), and the status
  tones in the dark theme's danger notice 4.13:1; a field's edge was the hairline that divides a card, 1.23:1 (dark) and 1.31:1 (light), so an empty field was a rectangle you could not
  see, and so were an unchecked box, a switch that was off and a field in error (1.4:1); the console and the terminal painted the light theme's status colours on a surface that stays dark
  (2.8 to 4.1:1); the segmented controls' unselected cells were 4.0:1 and the selected one differed by colour alone; a revoked key was a row at 60 percent opacity (2.4:1, every line of it);
  and links inside sentences were told from the words around them by a colour that is 1.2 to 2.3:1 against them. Now **text in a status colour has a token of its own**
  (`--success-fg` and the rest; the brand fills are what they were, except that the light theme's primary button is three points of lightness darker so that its label reaches 4.7:1),
  **a control's edge is `--control-border`** (3:1 against every surface, in both themes: fields, selects, the checkbox on an API key's scopes, the wizard's radio, the switches, the
  scrollbar), the console, terminal and diff are `gb-dark-surface`s that keep the dark tokens in either theme (and their text colour, which the console's command field had inherited as
  the light theme's dark ink, 1.1:1), **a selected row, chip and open file are marked by a bar and `aria-current`**, not by a tint alone, a revoked key is dimmed by its ink and says
  Revoked, links in sentences are underlined, the dashboard's node card says **Unreachable** or **Degraded** or **Healthy** in words (the dot was amber for both of the first two), the activity
  timeline says Done, Warning or Problem to a reader, the sparkline and the analytics chart read the theme's colours instead of the dark theme's values, and the heat map has four steps, the
  lightest 3:1 against its card. **A first visit from a machine set to light is light** (the panel was dark for everybody until the toggle was pressed once, and the first press of the
  toggle then did nothing); the choice, once made, outlives the system's. The two switches have a border and a knob in system colours for Windows high-contrast mode (not tried in one). `test/contrast.test.ts` computes all of it from
  `globals.css`, `design-canvas/Tokens.dc.html` carries the same values, and `verify:a11y` now fails on any `color-contrast` or `link-in-text-block` violation: 153 elements on 24 routes
  before, zero on 29 routes in both themes after.
- **What the panel tells you stays long enough to read, is spoken, and is shown where you are looking; a failure to reach it is a sentence, not an error page.** Every message
  went by after six seconds, errors included, with no pause for a pointer or for focus, in a polite live region that read a failure like a success; a message raised inside a dialog was painted
  under its backdrop (the page behind a modal dialog is inert, so no screen reader had it); and thirty of the thirty-four components that call a server action had no `catch`, so a cut
  connection or a restarted panel replaced the page with "This page could not be shown", or did nothing. Now **a failure stays until it is dismissed** and is an `alert`, spoken at once; the
  others go by themselves (eight seconds, twenty for a warning) and wait while the pointer or focus is on them or the tab is hidden; **a message raised while a dialog is open is shown in it**;
  and **an action whose answer never came says "The panel did not answer. Nothing on this page was changed, and it is not known whether the panel did what you asked. Check your connection and
  the Activity page before you try again."** (`useAction()` replaces `useTransition()` in all thirty-four components; the sign-in, second-step and API-key forms say it on the form, with the address
  kept). There is one toast provider for the whole document, so a message pushed just before a navigation (a clone that could not copy its world, the DNS warning after a create) is not destroyed
  with the page, and **deleting a server tells you, on the Servers page it lands on, which final backup was taken and what DNS record was left** (a one-time cookie carries it over the
  redirect that used to discard it). **A field's error is tied to its field** (`aria-describedby`, `aria-invalid`, and an icon, not only a colour; forms that check as you type tie it without
  reading it out at every keystroke), Add a node uses the shared field instead of its own copy, and a control that replaces itself leaves focus on the safe button (Cancel in eighteen places), on
  the first field of a form that opened, or on the secret that was just made. **Copy says what happened**: the clipboard needs https or `localhost`, and over plain http the Copy buttons on
  an API key, a setup link, the recovery codes, the two-factor secret, a webhook's signing key, the DNS name and the Add-a-node command said "Copied" whatever the browser did; they wait for
  the browser's answer, try the older way, and when both refuse say "Not copied", select the text and say to press Ctrl+C. Secrets wrap instead of being cut with an ellipsis, and the
  member's reset link is in the shared dialog, with Escape, focus kept inside and the page behind it inert, instead of a div drawn over the page. Measured in Chrome with the network switched
  off under a click: the alert is there, the page is still the page, it is still there nine seconds later and goes when dismissed; the same inside the Configure dialog; and a Copy the browser refused says
  "Not copied" and leaves the secret selected.
- **Every page can be reached on a phone.** Below 1024 px the sidebar is not drawn and the bottom bar named five pages, so fourteen of the nineteen an owner has, and the account page, could
  not be reached from a phone except by typing the address. The bar has a sixth item, **More**, that opens the whole list grouped as the sidebar groups it (and only what your role may open),
  and the avatar in the top bar is a link to your account: **every page is within two taps**, measured in Chrome at 375 and 768 px. **Members, API keys and the Audit log** kept their desktop
  columns at every width: at 320 px a Members row asked for 322 px of the 242 it had, so the member's name got none of it, API keys asked for 416 px, and the audit page scrolled sideways (its
  search box and its row of actors were wider than the window). Below 1024 px a row is now stacked (the name and address whole, the role and the servers under them, the actions at the end,
  the audit row's actor and time on one line), from there up it is the table it was, and nothing is wider than the window at 320 px. The Servers list says "CPU", "RAM" and "Players" to a
  screen reader at every width (they were `display: none` on a desktop, so a row read as bare numbers), and **the sidebar stays in the window while the page scrolls**, its list scrolling
  inside it with a thin scrollbar, so the account row and Sign out are always on screen. The accessibility check now runs against a panel it reaches as `localhost`: a dev server refuses the
  scripts of a page it is reached by `127.0.0.1` for (`Blocked cross-origin request to Next.js dev resource`), so the page was drawn and never taken over, and every check since it was written
  had been of HTML nobody is left looking at. Taken over, it found one more thing: in development React runs each effect twice, which made the first load of every page count as a navigation
  and put focus on the page's first control instead of leaving it for "Skip to content" (a production build was not affected).
- **Every page has a title, a way past the sidebar, a focus ring on every field, and a main region.** All but three pages said "Geeboard", so twenty tabs read the same, the history and a bookmark were
  useless, and the route announcement a screen reader makes when a navigation ends (Next speaks it only when the title changed) never spoke. Each page now says what it is (`Servers · Geeboard`; a server
  page its slug, a node page its name; a test fails on a page without one and on two with the same). **The first Tab on a page is "Skip to content"** (visible while it has focus) and it, and every
  navigation, put the keyboard on the page's main region: it was twenty-two controls of sidebar before the page, after every click, and focus was left on the document because the sidebar that had it was
  replaced. The wizard, the sign-in, setup and second-step pages, and the wizard's refusal now have a `<main>`; the sign-in page's first heading is the form's (`h1`), where it was a statement in a panel
  that is hidden on a phone. **Twenty-one fields had `outline-none`**, which beat the global ring (utilities win over the base layer) and left a one-pixel border at thirty percent accent (1.07:1 in the light
  theme): every field now shows a two-pixel ring when a keyboard reaches it, in both themes, and a test fails on an `outline-none` with none in its place. Anchors (`#delete`, `#move`) land clear of the
  sticky bar, and the regions that scroll (the console's log, the usage table, a collection's list, a manifest, the join command) can take focus. **`npm run verify:a11y`** (new, with a browser) runs axe-core
  over 29 routes in both themes and presses Tab: zero violations of `document-title`, `bypass`, the landmark rules, `page-has-heading-one` and `scrollable-region-focusable`, the first Tab and Enter reaching the
  main region, a ring on a field in each theme, and no page wider than its window; what axe still finds (contrast, the meters' names, target sizes, one list, links told by colour alone) is written down
  in `scripts/a11y-baseline.json` and may not grow.
- **What a screen reader and a keyboard meet where the page moves by itself, or asks for one choice among several.** *The console's log is not a live region until it is asked to be*: it
  was `aria-live="polite"` over every line a game prints (several a second) and kept speaking while it was paused. It is off, with a button to read each line aloud (`aria-pressed`,
  remembered in the browser), and instead a status says "7 new lines, 1 warning" at most every two seconds, and that the output is paused; the pause button keeps one name and a state;
  rows are keyed by what they say and not by their place in the list (past 500 lines every row was made again, which a live region reads as 500 additions); a dropped stream is an alert.
  *The terminal* has a **Screen-reader mode** button (xterm builds a readable copy of the output only when asked, and it was never asked), a named group that says Tab is the shell's and
  Shift+Tab leaves, takes focus when it first opens and not again at every reconnect, and a cursor that does not blink for somebody who asked for less motion. *Every progress bar has a name*
  ("aurora CPU", "Download progress"; `Meter` takes a required `label`), and the Servers page no longer draws the CPU a node had before it went beside a dash. *The create wizard's* game,
  version, template and node are radio groups (a name, one tab stop, the arrow keys choose), its steps are named ("Back to step 2: Which build should it run?"), a change of step moves focus to the
  new heading and says "Step 3 of 5", the sliders say "4 GB" and not "4", and "Change" says what. *The heatmap and the players chart* say what they show in a sentence and have their figures as
  a table. A control that armed a confirmation gets focus back when it is cancelled (`useRestoreFocus`; the Cancel already took it on the way in). The dialog's close button reads "Close", a game's
  cover and a person's initials are no longer read before their names, the games page's list of requirements is a list, and the phone's bottom bar is opaque (a translucent one over the console's
  dark panel was 3.2:1 in the light theme). `verify:a11y` now fails on **any** axe violation of the rules it knows (the baseline is empty: the meters' names, the list and the 24 px targets
  were the last three) and checks the console, the wizard and the charts as above, 90 checks, at 1280, 375 and 320 px. **Not done:** a person with NVDA, Narrator or VoiceOver listening: every
  check above is of what the page says, not of how it is heard; tables are still CSS grids (a row is not navigable by column). **Forced colours** (Windows high contrast) were looked at in Chrome's emulation of them, six pages: text and edges survive and every state is also a word; the
  meters' bars did not (the figure beside each stood alone) and have an edge and a fill in the system's highlight now. A real Windows machine in high contrast has not been tried.
- **A page does not wait on a node that is down, shows its servers as unknown, and keeps itself current.** The poller skips a node it cannot reach, so its servers kept the last state and
  player count they had: a green "Running" and "12 / 40" on a machine that had been gone for an hour, with Console and Settings (which ask the node while they draw) waiting ten seconds,
  twenty for a game with two settings files, for an answer that was not coming, on a navigation that showed nothing until it was whole; nothing refreshed by itself, so after **Start** the
  page said "Starting" until somebody reloaded, and **Stop** left the pill on "Running" for up to a minute. Now **a node that is not answering (after 30 s) or unreachable (after two
  minutes) is not asked**, and one that is still called healthy is given **2.5 seconds** (the connection's own limit, so the call is cut off and not only waited out): on the VPS with the
  agent frozen, Console and Settings answered in **2.6 s at ten seconds, 0.13 s at a minute and 0.13 s at two and a half**. **Its servers read "Unknown"** — `deb-node unreachable since
  7 Oct, 12:44`, in the reader's clock — on the dashboard, the Servers list, a member's home and the server's page, with the players as `—`, the last figures dimmed, the controls drawn
  and disabled with the reason on hover, and the dashboard counting them as neither up nor down; the node's page says what to check, in order. **An agent behind the panel's contract is
  said on the Nodes list and the dashboard** (`agent behind`), where it read "Healthy" until the first create refused. **A page draws itself again every five seconds while a server or a
  node on it is on its way somewhere** (every fifteen after two minutes, none after ten, only while the tab shows, and at once when it comes back), and **a press of Start, Stop or
  Restart says what the server is about to be at once**, in the pill and on the button (`Stopping…`): "Stopping" 153 ms after the press, "Stopped" and then "Running" on screen without
  a reload. A link whose navigation is pending shows a dot (a `loading.tsx` outline was tried and not kept: it makes a signed-out request, or one sent to the account page, a 200 with a redirect for the browser and not the 307 every gate expects). Times are the reader's own clock where they were the server's (the greeting, the charts' axes, "last sent",
  "answered", a file's date). The independent reads of the Settings page and the server page run together (some thirty round trips on Settings, nine on a server's page), the bucket is read
  and decrypted once and not three times, and the dashboard's last-hour CPU is averaged in the database, about twelve rows a server and no longer every sample.
- **Errors keep their cause and say it.** An error nobody foresaw was turned into "Something went wrong on our side." in 53 places and its cause was logged only on the API path: a
  backup, an update, a move or a create that hit a Prisma error wrote that sentence to the toast, the audit row and the notification, and nothing anywhere else. Now the sentence
  carries a **reference** (`Something went wrong on our side (reference 610eb3ed896794d5). The panel's log has the details.`, `details.reference` in the API) and the log has one
  `unexpected error` line under the same string, with what was being done, the kind of error, its message and the first lines of its stack; converted once however many catch blocks it
  passes. **What Docker and the disk say is read on the agent** (`PORT_IN_USE` with the port, `NO_SPACE`, `PERMISSION`, `DOCKER_DOWN`, `DOCKER_PERMISSION`, `IMAGE_REFUSED`, as
  `{ error, code, details }`; Docker 29's "failed to bind host port 0.0.0.0:25565/tcp: address already in use" included) and worded by the panel for the node's name — "Port 25565 is already
  in use on deb-node by something that is not this server. Free it, or create the server on another node." — where it showed Docker's text and a host path, and an agent 500 is a new
  `RUNTIME_FAILED`, not `RUNTIME_UNREACHABLE` for a client to retry as if the node were away. **The agent's 401 is a sentence**: "deb-node refused the panel's token (401)… Rotate it from
  the node's page, or join the node again", where it said "Cannot start — unauthorized"; and **the agent stops printing a line every fifteen seconds for ever**: a panel that refuses it is
  told once what to do and asked again every five minutes, a panel that is away at 30 s, a minute, doubling to five (with jitter), a beat that hangs is waited for and not stacked, and the
  panel logs why a heartbeat was refused (unknown node, token unreadable, token mismatch), once in ten minutes for each node. **A node that does not answer says why** (refused: the agent
  is not running; no answer within 10 seconds: a firewall or a machine that is off; the name does not resolve; a certificate it does not trust, with this panel's clock when it is expired
  or not yet valid; an answer that is not an agent's), with the node and the address, one sentence for the poller, the heartbeat's probe and every operation, where it was "fra-node-02 is
  timed out". A failed move says where it stopped in words ("while switching the server over", not "while switch") and whether the node was asked to clean up and answered. Twelve sites that
  put a full stop after a message that might already end in one (and one that read "its world is intact and backup complete is locked") go through `bare()`, and a unit test reads the source for
  the mistake. The console says why it would not open (a session that ended, a role that does not watch, a node with no agent) where it showed "Disconnected" and an empty box, and the file
  manager no longer does nothing on a click when the panel does not answer. Proved on the VPS: a Minecraft server created while a program held 25565 (the classified sentence, no row left,
  Docker's text only in the agent's log); a node's stored token replaced (the toast says the token does not match, the agent printed its instruction at 10:07:48 and again at 10:12:19 where it
  printed one every 15 s, no "heartbeat failed", one refusal line on the panel); a backup whose last database write failed (the toast, the audit row and exactly one log line carry the same
  reference); the agent stopped (the node's page says "refused the connection at …: the agent is not running there"). **Not done**: a "last refused heartbeat" on the node's row (the log has
  it), and an installer log (that was the installer part's).
- **A watchdog you can see, and one poller that is really one.** The poller is the process that looks at every server and every node, restarts what crashed, runs the schedule and sends
  the notifications, and when it was dead or stuck nothing said so (the things it would have said are the things it does). It now writes one row (`poller_state`: when it started, when
  each pass began and ended, how long, how many servers and nodes, which release), and the **dashboard and the Nodes page say "Watchdog: last pass 6 s ago"** and turn into a warning
  past three of its own intervals; a pass that has run that long (something in it is slow: a node, the DNS provider, the database) is told apart from a poller that is gone.
  **`docker compose ps` shows healthy or unhealthy** for the panel (`GET /api/health`, new, unauthenticated: `{ok, version, schema}`, 503 when the database does not answer) and for
  the poller (a pass within three intervals); the compose file also caps every container's log at three files of 10 MB (Docker keeps every line for ever on a machine with no
  `daemon.json`, and the poller writes one a pass), checks Postgres over TCP and not the socket the first-boot server answers on, and **passes `LOG_LEVEL`, `LOG_FORMAT`,
  `POLL_INTERVAL_MS` and `CATALOG_SYNC_INTERVAL_MS` from `.env`** with their real defaults: they were read by the code and could not be set in the shipped file. **A second poller
  now leaves** with one line and exit code 75 (a lock in the database, on a connection of its own, taken at start; one whose connection ends leaves too and its restart policy
  takes the lock again): `docker compose up -d --scale poller=2` and a `poll:once` that overlapped a long pass used to double-send every notification, run every backup twice and
  write two DNS records at a name. Old rows are pruned from the clock, hourly, and not at every 240th pass of a process that has to live an hour to get there (a poller
  restarted more often never pruned); the two sample tables get an index on `at`, which the prune filters by; and the database pool gives up on a connection after five seconds
  instead of for ever. **A migration** (`poller_state`, two indexes): `install-panel.sh` or `panel migrate` applies it, and until it has the pages leave the line out. Measured on
  the VPS, with the image built from this tree: the poller's own process stopped inside its running container, the dashboard and the Nodes page said so after three missed
  passes and `docker compose ps` said unhealthy 55 s after, with the check's own words ("last pass 48 s ago, more than 3 intervals of 15 s"), and healthy again when it was let go;
  `docker compose up -d --scale poller=2` gave a second poller that left with exit code 75 and one line saying why (Docker restarts it with a growing delay, each time with the same line,
  until it is scaled back to one); `/api/health` answered 200 and, with the database stopped, 503, and the poller, whose lock connection went with the database, left, restarted
  and was healthy again 40 s after the database; `LOG_LEVEL=debug` and `POLL_INTERVAL_MS=5000` in `.env` reached both containers and `up -d --wait` returned in 20 s.
- **A Windows PC can be joined again without losing its settings, and checks what it needs.** Running the panel's command again (which the dialog tells you to do to rebuild
  or re-register a machine) wrote the settings from the command alone, so a PC installed with `-DataRoot D:\GameServers` looked under `C:\ProgramData` afterwards, its
  servers still running from the old place, a backup that archived an empty folder and succeeded, and a restore that replaced the wrong one; the port and the declared
  capabilities went back to their defaults too. `join` now starts from what the last one saved (on Linux as well) and says what it kept; a token for another node than the
  machine is joined as is refused with the token still good (`--replace` / `-Replace` says it is meant). The installer refuses Docker in Windows-containers mode (it registered, then
  refused every game) and Node older than 22, makes the data root and sets it to this account, SYSTEM and Administrators (a folder under ProgramData lets every local account read
  every world and the RCON password), makes a Windows Defender Firewall rule for the agent's port and the panel's addresses when it is elevated and prints the command when it is
  not (the only check it made was on loopback), and ends with what takes *this* PC node down (sleep, Docker Desktop not starting at sign-in, a battery, sign-out).
  `deploy\windows\doctor.ps1` looks at all of it and changes nothing; `uninstall-agent.ps1` takes `-Purge` and `-PurgeData`. The terminal's PTY library is an optional
  dependency: with github.com unreachable `npm install` failed (measured: exit 1) and the agent could not be installed at all, to protect a feature that is off by default; it
  now installs (exit 0) and the terminal is reported unavailable, with the reason. The agent no longer says `windows` before Docker has answered (a PC's agent starts at sign-in
  before Docker Desktop does, so the panel audited two platform changes at every sign-in: measured two with the old agent, none with this one), and claims `ipv6` only for a
  global or unique-local address (a link-local `fe80::` is on every PC). Measured on the PC beside the real agents: a fresh command kept the data root on D:, the port,
  the capability and the terminal; the token for another node was refused and was still unused on the panel; a server created on the node was in `D:\GeeboardP18` and only
  SYSTEM, Administrators and the account could read it, where `C:\ProgramData\Geeboard` is readable by every user; Docker said "windows" and Node said v18 and the
  installer stopped in stage 1; `-PurgeData` refused while a container kept its files there and went through once it was gone. **Not shown:** the firewall rule being made
  (the shell was not elevated, so only the printed command was run), and a second Windows account reading the folder (none exists here; the access list was read instead).
- **A machine that is gone no longer leaves its servers, and its node, on the panel for ever.** A delete asks the node to remove the container, and a move asks
  it too, so with the machine destroyed neither could finish and the node could never be retired (the documentation said so, and offered nothing).
  When the panel has not reached a node for longer than it takes to be called unreachable, the server's Danger zone offers *The machine is gone: forget this
  server*, and the node's retirement card a **Forget** link beside Move and Delete. Forgetting removes the panel's record and sends nothing to the machine;
  it is refused unless the panel has not reached the node for two minutes **and** the node does not answer at all: an agent that answers with any status (Docker stopped under a live agent, a refused token) is there, it cannot be combined with a last backup, it writes `server.forgotten` and says the
  machine was not asked, and off-site backups stay. Over the API, `DELETE /servers/:id` with `"forget": true`. What was on the machine stays on it; if it
  comes back, remove the container and the folder by hand. `npm run verify:forget` holds it (31 checks).
  Seen in a browser against a node whose address answers nothing, which also showed that **a node's own page drew its servers as *Running*, with the CPU
  they had before it went, under a banner saying they are shown as unknown**: they are *Unknown* there now, as on the Servers page, and the header does not count how many are up.

### Security

- **Server operations on a page check the permission table.** See "What changes for you": a member given a server could do on
  the page what only an owner or an admin may do over HTTP. Held now by one table of who may do what, a test of it, and a
  verification that replays each page action as each role.
- **The agent no longer dies of a request of one line.** `GET //[ HTTP/1.1`, sent to a node's port with no token at all,
  made the agent throw before it had checked who was asking, and it exited (in every release so far; on Linux systemd brought it
  back after five seconds and every console, backup and upload in flight was gone; on Windows nothing brings it back).
  A request target the agent cannot route is now a `400` and the same process keeps answering; a download whose client went
  away no longer ends the process either; and anything unforeseen that does reach the top is written as one structured line,
  then the agent exits with a code a supervisor restarts on.
- **An address nobody has no longer answers faster than one somebody has.** The dummy hash an unknown address was compared against was 65
  characters, which bcrypt refuses outright, so it answered in 0.01 ms against 264 ms for a real one, the opposite of what the
  documentation said, and "does this account exist" was a stopwatch. Measured now: medians of 258.3 and 258.7 ms over fifty sign-ins each.
- **Reading a stored secret no longer stops the panel for 30 ms.** The key was derived with scrypt on every read, by every page that touched
  a node, a bucket, a DNS provider or a notification channel, by the poller for every node on every pass, and by the heartbeat before it
  compared the token: about 33 bad heartbeats a second, from anybody who knew a node's name, kept a core busy and stopped the panel
  answering anyone. It is derived once (0.01 ms a read now), and the heartbeat and registration routes refuse a source that has failed
  thirty (ten for registration) times in a minute without reading its request, whatever it puts in the first `X-Forwarded-For` entry.
  A node whose real token is proved is never refused because a stranger guessed at its name. An API key's bcrypt compare (73 ms of
  stopped panel, a hundred times a minute for a client that polls) is remembered for five minutes, and the row is still read each
  time, so a revoked key is refused at once.
- **Every response carries security headers.** `X-Content-Type-Options`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, a referrer
  policy (never `no-referrer`, which would make every POST's `Origin` `null`), a permissions policy, and no `X-Powered-By`; a panel at a
  **name over https** also sends HSTS for a year (an address, plain http and localhost do not). A script policy with nonces is not set yet.
- **A request that changes something and carries only a cookie has to come from the panel's own pages.** `POST`, `PUT`, `PATCH` and
  `DELETE` under `/api/v1` check `Origin` and, with a body, that it is JSON; a request with an API key is not asked. Nothing in the product
  sent one; this is for a script that copied a cookie, and for a stranger's page.
- **A game can no longer win a race against the Files page.** The agent checked a path with `realpath` and then used it by name, so a
  process inside a server (a game, a mod, a plugin) that swapped a directory for a link to somewhere else at the right moment had an upload,
  a save or a delete land outside the server's folder: in a test, 12 files outside in about 5,600 swaps. On Linux the agent now walks the
  path through directories it holds open and never follows a link it has not read, so there is nothing to win: none outside in 9,300 swaps.
  An upload is also written under a name nothing can guess (`<dataRoot>/.uploads`) and renamed into place, not beside its target under
  `<file>.<pid>.<ms>.upload`. Links that stay inside the folder work as before; one that leaves it is refused, and a listing describes it
  as "other" with no size. **Not closed:** Windows keeps the `realpath` check, and a recursive delete on Linux still hands its folder to
  the system's remover, so a directory swapped for a link *inside* that folder during the delete is a window. Both are in the limitations.
  The agent contract stays 1.
- **Smaller:** a node's address at registration is refused if it is the cloud metadata service or another link-local, multicast or unspecified
  address, or has a password written into it (the token is not spent, so the command can be run again); a carriage return inside a console
  command is refused, in the panel and in the agent, as a newline was; recovery codes are a salted scrypt hash and not SHA-256 (the ones you
  have still work; make new ones from the account page to move them); the audit export's cells that begin with a tab or a carriage return are
  made text too, and a carriage return inside a cell no longer ends the row; the Terminal page tells a member that it is for owners instead
  of "No nodes yet" and a link to add one.
- **Checking the off-site bucket is in the audit log.** `docs/security.md` said configuring, testing and forgetting it were audit events; testing
  was the one that wrote nothing. `storage.checked` is recorded with the bucket and whether it answered (a warning when it did not), and never a key.
  The page also says what `/api/v1` routes are open to nobody signed in (`nodes/register`, `nodes/heartbeat` and `panel-ca`, each with its reason) instead
  of "every route authenticates first", and what the fall-back from `SECRETS_KEY` to `SESSION_SECRET` does outside development.

### Upgrading

- **An upgrade takes a dump first, and says how to go back.** Re-running `install-panel.sh` is the upgrade, and it ran `migrate`
  under the old panel and poller, with no copy of the database, said "no data was changed" when a migration failed, and printed nothing
  about undoing it. A panel that is already running is now looked at for operations in flight, stopped (the poller gets two minutes to
  finish a pass), dumped into `/var/backups/geeboard/` (root only, read back before it is believed, with the secrets file beside it),
  migrated once with Prisma's output kept and each migration's time shown, started, and the commands that undo it are printed — they were
  run as printed on a real machine, and the data came back as it was. A migration that fails leaves the panel and the poller stopped and says the
  database may be partly changed. `--no-backup`, `--backup-dir <dir>` and `--force`; `docs/upgrading.md` is one procedure now.
- **A panel on a database that is not at its schema says so and does not start.** A release behind (nobody ran `migrate`), a release ahead
  (a newer image migrated it and an older one was started), a migration that did not finish: one sentence and the command, from the panel and
  the poller, and on every page of a panel that is already running, instead of "something went wrong, trying again usually works".
  `panel status` and `panel resolve` are new verbs of the image; `panel migrate` ends with an offline catalog sync. `npm run verify:upgrade`
  builds the database 0.4.1 left, applies this checkout's migrations to it and checks every count, the DNS records the 0.7.0 migration copies,
  `prisma migrate diff`, and a migration that fails and is put right.
- **A re-run reads the machine it runs on.** A panel on a domain stays on its domain: a bare re-run or `--yes` used to take the default
  answer to "do you have a domain?" and rewrite a Let's Encrypt site as `tls internal`, taking every remote node off the panel while the
  installer's own check passed. The mode is recorded in `deploy/panel/.env` (`PANEL_TLS_MODE`, `ACME_EMAIL`; an older install is read from
  its Caddyfile). An agent on the same machine is upgraded with the panel, with its version before and after and its contract (it was
  "Not a node"); a missing `.env` beside the database volume stops the run before it writes new secrets; registering this machine under
  the name of a node that exists asks first (refused under `--yes`); the last words say *installed*, *upgraded from X to Y* or *already here*,
  and a checkout that is not at a release tag is warned about.
- The compose file gives the poller two minutes to stop and the panel thirty seconds (it was ten for both: a poller in the middle of a scheduled
  backup was killed by `docker compose stop`), and pins Postgres by digest, so **the first `up -d` after this release recreates the database
  container**. Its volume is untouched. A checkout made before 0.9.0 has scripts recorded without the execute bit and `git pull` refuses over
  them; `git config core.fileMode false` once, then pull again. `docs/upgrading.md` says it first.
- **Servers that were running when a 0.4.1 panel is upgraded stay healthy.** Found by upgrading a real 0.4.1 panel with two Terraria servers on it:
  both read *UNHEALTHY, the console has not reported it ready* for good. 0.4.1 never wrote down the moment each console said it was ready, the
  health check then judged a server on the last 120 lines of its log alone, and a busy server pushes its ready line out of them within minutes.
  A data migration (`running_servers_were_ready`) records, for each server that was running, the judgement the old panel had made; a server that was
  already marked unhealthy is left for you to look at. The upgrade left the game containers where they were (their start times did not move).
- **The installer refuses to start an image that is older than the database.** A re-run on a checkout that is ahead of its release, without
  `--build`, swapped a working 0.9 build for the published 0.8.1 image and said the schema was up to date, because `migrate deploy` has nothing to
  apply when the database is ahead. It now compares the migrations in the image with the ones in the database before it stops anything, says which
  it does not know, and stops; `--force` goes on.
- **`npm run db:migrate` and `db:reset` generate the Prisma client**, which Prisma 7.10 no longer does for you: the laptop flow
  the documentation describes ended in a client that did not know the new tables.
- **A node that is removed does not leave its port unit running.** `agent-port.sh remove` stopped nothing, and the one-shot stayed *active (exited)*
  for a unit that was no longer there until the next boot.
- **Ubuntu 22.04 has no Caddy package, and the installer says so before it builds anything.** It stopped at stage 6, after the image, with the package
  manager's `E: Unable to locate package caddy` in a log. It now looks in stage 3 (and `--check` says it), and stops with nothing changed unless you
  pass `--caddy-repo` or answer yes: it then adds Caddy's own apt repository (the key fetched over https into a keyring that trusts that repository
  only) and installs from it. Ubuntu 24.04 and 26.04 and Debian 12 have the package. It is never done unasked: it puts a third party's key on a machine
  that runs as root.
- **A panel behind NAT is no longer reported as not answering.** The installer's last check, and `doctor.sh`, asked the machine's own public address, and a
  home router (or WSL, or a virtual machine on a PC) does not loop a request for its address back to the inside: a right install read *Geeboard is installed,
  and its address is not answering yet*. For an address — not a name, which is asked as a browser asks it — Caddy is asked on this machine for it (with `openssl`, which names the address in the
  handshake; curl sends no name for an address, and Caddy then has no certificate for the address the connection arrived on), the
  certificate still checked against the address, and the last words say so. Found installing on Ubuntu 22.04 under WSL. Whether the router forwards 80 and
  443 is still only shown from another network, and the page says that.
- **CI installs the panel with Caddy on Ubuntu 22.04 and 24.04.** The install job passed a panel URL, so nothing in CI had ever started Caddy.
- **A database that is not answering is said as that, `503` with `Retry-After`, and not as a fault in the code.** With the database container paused for three minutes on a real machine
  every page answered *Something went wrong on our side* and every API call `500 INTERNAL`, the same as a bug, so a client that retries on a 503 had no way to know and a person was
  sent to the log for a thing it says in one line. The pg client's own words and Prisma's and Postgres' codes (a connection terminated or timed out, an administrator's shutdown, the
  cluster starting up, too many clients) now answer `DATABASE_UNAVAILABLE`, 503, `Retry-After: 5`, *The panel's database is not answering. Whether what you asked was done is not known* and where to look
  (the log still has the cause, under a reference). A refused connection counts only when it says it was going to Postgres: a node that refuses has its own sentence. Shown against a
  throwaway Postgres paused under a real connection (5.1 s, then 503, then answering again after the unpause); the API's error table has the code.
- **The doctor says what a 404 from `/api/health` means.** A panel that answers its sign-in page and has no `/api/health` is a release before the route (0.8.1 and
  earlier) under a checkout that has it, which is what a checkout of a branch ahead of any release gets when the installer pulls the published image. It said `answers 404`;
  it now says the panel is older than the checkout and to run the installer from it (`--build`), or to check out the tag the image is.
- **Corrected: an agent on 0.4.0 does need upgrading for a 0.5 or later panel.** The release notes of 0.5.0 to 0.8.1 and `docs/upgrading.md` said no agent
  upgrade was needed from 0.4.0; the code (a 0.4.0 agent sends no contract, so its release line decides) and its test said otherwise, and a real
  0.3.5 agent under a 0.4.1, 0.8.1 and this panel was refused three times of three. The notes of those releases and the page say it now.

### Backups and restores

- **The cleanup no longer removes good backups because of failed ones.** It kept "the newest N rows", and a row can be a backup that
  failed: seven days of failures (a disk that filled, a node whose uplink to the bucket was cut) left seven failed rows in seven
  slots and every good backup older than them was removed. It counts complete backups only, removes failed ones after a week
  with whatever archive they left, and never touches a running or a locked one.
- **A restore that cannot finish changes nothing.** The archive is unpacked beside the world and the two are exchanged only when it
  is whole. Before, the world was emptied first: a truncated archive replaced it with a partial one, and a missing archive removed it
  and made the agent exit. Now the answer says *Nothing was changed*, and the server goes back to what it was doing. A node without
  room for two copies refuses with the numbers and offers **restore in place** (a checkbox; `"inPlace": true` over the API), which
  removes the world first and says plainly that a failure then leaves it incomplete. The agent moves a world back that a power cut
  left set aside between the two renames.
- **A backup the disk cannot hold is refused with the numbers,** not allowed to fill the disk every world on the node writes to; the
  floor kept free is the larger of 2 GB and 5 percent (`GEEBOARD_BACKUP_FLOOR_BYTES`). A world that is being written to is archived
  as each file was when it was opened and the result lists what changed, instead of failing the backup (nineteen of twenty failed on a
  server with a busy log). An archive is written under a `.partial` name and listed only when whole, so a process killed mid-backup
  no longer leaves a file that looks like a backup; what a kill leaves is removed at start. A failed off-site upload is retried, and
  the archive is kept as a local backup rather than left on the node with no row.
- **What changes for you:** an agent before 0.9 still empties the world first. The panel works with it, but the restore guarantees
  above need the new agent: upgrade your nodes. The failed-backup rows older than a week are removed by the next cleanup.

### Tooling and the project's own checks

- **A verify script refuses a database that is not named for verification.** `npm run verify` from the wrong directory replaced a
  running demo with the sample workspace on 2026-09-20; one of about two dozen scripts refused it. All of them do now, naming the
  script and the database; `db:reset` and `db:seed` ask for the database's name. Set `GEEBOARD_VERIFY_ANY_DB=1` or
  `GEEBOARD_CONFIRM_DB=<name>` to mean it.
- **`npm run verify` goes on after a failure** and ends with a table, instead of stopping at the first. Two scripts had failed for
  three pushes, one behind the other. The development database's port is bound to this machine only.
- **CI is pinned and narrower.** Every job runs on `ubuntu-24.04` (the `ubuntu-latest` label moves to 26.04 from 2026-10-19), with a
  26.04 leg beside it that may fail without failing the run; Node 22, the floor the documentation promises, runs the type check and
  the unit tests; the actions are on their current majors; a job has a timeout, the workflow reads the repository and a tag run's
  install of npm packages no longer sits next to a token that can publish. `.github/dependabot.yml` and a weekly advisory job
  (`scripts/audit-gate.mjs`, with the advisories somebody has read in `.github/audit-allow.json`) watch the dependencies.
- `next` 16.3.8 (0.8.1 shipped 16.3.5, which has a critical advisory in `next/og`, a route the panel does not use), `sharp`,
  `source-map-js`, `fast-uri` and the agent's `@grpc/grpc-js` 1.14.5; both packages declare Node 22 or newer and approve the
  install scripts they rely on (`allowScripts`). The base images are pinned by digest. `SECURITY.md` says how to report a
  vulnerability and which versions are fixed. `daemon/src/provision.ts` had a raw NUL byte in a regex, which made git treat it as
  binary and hid it from every diff and search; it is written as an escape and CI fails on any other.
- **The documentation's addresses are frozen and its outside links are read.** The 21 pages the first site served are listed in `docs-src/addresses.txt`
  and the link check fails if one stops answering (it used to derive the list from `docs/`, so a renamed page took its address with it).
  `docs-external.yml` asks every address that leaves the site, every Monday, and fails on a 404 or a 410 and on nothing else.

### Changed in the agent

- **Stopping is quick.** `systemctl restart geeboard-agent` with a console open took 30 s (it waited for the browser to let go
  and ended in SIGKILL); it now takes under a second: open console and terminal streams are closed at once, a request in
  flight gets 20 s to finish, and a request that would change something is refused with `503` and `Retry-After` meanwhile.
- **A second agent on a taken port says so, once, and is not restarted.** It prints the sentence, exits with code 78 and the
  unit's new `RestartPreventExitStatus=78` leaves it stopped, instead of a restart every five seconds for ever. Re-install
  the unit with `sudo bash deploy/linux/install.sh` to get the line.
- **A file the editor can open can be saved.** The body limit of 64 KiB applied to saving a file too, so a config the panel
  opened at 100 KB could not be written back; it is now sized for the editor's 2 MB.
- **A long upload is not cut at five minutes.** A 200 MB file over a 4 Mbit/s line needs about seven; the request as a whole is
  now bounded at an hour and a connection that stops sending is cut after two minutes.
- **A typo in a number is a sentence at start.** `GEEBOARD_PULL_STALL_MS=2min` used to make every pull "stalled" within five
  seconds; every numeric setting is now checked when the agent starts, and a bad one names the variable.
- **The agent listens on both address families** (`::`, which takes IPv4 too, and falls back to IPv4 on a machine without IPv6; `GEEBOARD_DAEMON_HOST`
  still says an address). It was IPv4 only while `join` can advertise an IPv6 address. **`/health` no longer names the node:** it answers `{"ok":true}`
  to anybody, and nothing reads the name (the panel, the installers and the Windows installer read `ok`). Both are additive: contract 1.
- **`join` and a new `pin-ca` verb.** `npm run pin-ca -- <panel> <sha256:fingerprint | file> <where>` (and the image's `pin-ca` verb, which `install.sh` runs) fetches the
  panel's authority and keeps it only if it matches (see above). `join` takes one pair of quotes off the address, the token and every option (ASCII or curly), says why a
  panel it cannot reach cannot be reached (it printed `()` when both an IPv4 and an IPv6 address refused), leaves through the end of the program and not `process.exit`
  (Node on Windows printed a libuv assertion under the message), and the agent's certificate message names the option of the platform it runs on. Additive: contract 1.
- Smaller: bad JSON is a `400`, not a `500`; `/health` gives up on a hung Docker after five seconds; a create on a node whose Docker is not
  answering says so instead of asking you to pull an image the node already has; a console that closes while the engine is
  still answering no longer leaves a log stream running.

## [0.8.1] — 2026-10-06

**The release you can install: 0.8.0 was tagged and never published.** 0.8.1 is 0.8.0 with the project's own
checks repaired. Nothing in the panel or in the agent changed.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.1, 0.5.0, 0.6.0, 0.7.0 or
0.8.0.** The agent in 0.8.1 is the 0.4.1 agent with its version moved, because a release tags the panel and
the agent together.

### Why there is no 0.8.0 image

A tag publishes the panel and the agent to GHCR only after the whole of CI passes, and the panel's CI job had been
failing since 0.5.0. `verify:templates`, which 0.5.0 added to `npm run verify`, starts a real agent from `daemon/`,
and the job had never installed the agent's packages: it timed out waiting for it. `verify:community`, after it in the
chain, refuses any database not named `geeboard_verify`, which the job's was not. Both pass on a machine that has the
agent's packages and a database so named, which is why neither showed locally. So **no image was published for 0.5.0 or
0.8.0**, and `v0.6.0` and `v0.7.0` were never pushed. 0.8.1 has everything the four of them changed.

### Upgrading

**From 0.4.1 or any earlier release, go straight to 0.8.1.** The migrations of each release in between are applied in
order by `panel migrate`, and [docs/upgrading.md](docs/upgrading.md) has what each one asks of you: read the sections
from your version up to 0.8, and **back up the database first**. The panel image is
`ghcr.io/danielemarino70/geeboard-panel:0.8.1`.

### Fixed

- The panel job of CI installs the agent's packages, and its database is named `geeboard_verify`. It runs the whole of
  `npm run verify` and the production build again, and a tag can be released.

## [0.8.0] — 2026-10-04

*Tagged as `v0.8.0`, but its release checks failed and no image was published: install 0.8.1, which is this with the checks repaired.*

**A third DNS provider, which is any DNS you can reach with a small program of your own, and an off-site
bucket that says what each store asks for.** Two things that do not depend on each other: a webhook that
tells a receiver to set or remove a server's records, and a storage form that knows Backblaze B2, Amazon S3 and
Cloudflare R2 by name — and a stand-in store for the verification that can be pulled again.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.1, 0.5.0, 0.6.0 or 0.7.0.** The
agent in 0.8.0 is the 0.4.1 agent with its version moved, because a release tags the panel and the agent
together.

### DNS

- **A webhook as a DNS provider.** For BIND, Knot, PowerDNS, a router, or a host with an API of its own, the
  panel does not write the records: it sends a receiver you run `dns.set` and `dns.remove`, signed as a
  notification is, each of them something that can be said twice, and the receiver does the writing. The
  DNS page makes the signing secret in the form and shows it once, **before** the receiver has to hold it,
  because a receiver that checks signatures cannot answer the test that saves the provider without it; nothing is
  saved unless the receiver answers that signed `dns.test` with `2xx`. The panel sends **what changed** and not
  everything again, an `SRV` too, and the receiver decides what it keeps. A record there is **accepted**, not
  *written*: a `2xx` says the receiver will act, and the panel cannot look at your DNS. See
  [docs/dns-webhook.md](docs/dns-webhook.md), which has the contract, what each status means, and a receiver that
  runs `nsupdate` in about a hundred lines — [`examples/dns-webhook/receiver.mjs`](examples/dns-webhook/receiver.mjs),
  a file the page and a test hold to be one.
- **It goes out under a notification webhook's rules and no looser ones**: https to a public address, or a private
  network and plain http when the operator has set `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1`; every address its name
  resolves to judged; no redirects; a five-second timeout; and the answer read for its status alone, never kept or
  shown. The address is stored encrypted beside the secret, and `rekey` seals both.
- **A receiver that is not there is waited for once.** Creating, moving and deleting a server wait for the call.
  The poller now leaves the rest of a pass alone after a provider could not be asked at all, and does not ask again for
  five minutes: measured with a receiver that never answers, a pass over six servers took 5.1 seconds.
- **The provider kinds are a table**, not a `cloudflare ? … : DuckDNS` in a dozen places: what each can hold (an SRV),
  whether it can be read, and what the panel may call a record it took. A kind that is not in the table is an error
  and is no longer taken for DuckDNS, and the wizard's and the settings' hints follow the kind and not the zone's name.

### Off-site storage

- **The form asks where the bucket is.** Amazon S3, Backblaze B2, Cloudflare R2, or a self-hosted store, each with what it
  asks for from its provider's documentation. **The region follows the endpoint** where the endpoint carries it, and a
  region that contradicts it is refused before anything is sent, with the one it says: a wrong one came back as
  `SignatureDoesNotMatch`, which does not say which part was wrong. A store's refusal is explained where there is
  something to do (`RequestTimeTooSkewed` is the panel's clock). The form says, for a provider Geeboard has not been run
  against, that the first save — a test upload and its delete — is the test.
- **Run against a real Backblaze B2 bucket, which found a bug.** The panel's own test upload was sent chunked, and
  Backblaze answers that with `411 MissingContentLength`; MinIO and SeaweedFS take it, so no store the panel had been run
  against could have shown it, and a first save at Backblaze could not have worked. A body now goes with its length, in the
  notification webhooks and the DNS webhook too. Then the off-site half of `verify:backups` passed against the bucket —
  147 checks, virtual-hosted and again path-style. Amazon S3 and Cloudflare R2 were not run. A bucket that keeps old versions
  keeps a deleted backup: measured at Backblaze, with the lifecycle rule *keep only the last version*, a deleted archive is
  still there, hidden, until a day after, and the form and [docs/backups.md](docs/backups.md#which-store) say so.
- **`npm run verify:backups` runs again.** Its stand-in store was MinIO, whose image can no longer be pulled; it is
  SeaweedFS, pinned, which checks signed requests and presigned URLs as a real one does. With `GEEBOARD_VERIFY_STORE`
  naming a JSON file kept outside the repository it runs the same half against a hosted bucket instead
  ([docs/field-checks.md](docs/field-checks.md#off-site-backups-against-a-real-provider)).

### Also

- **A good community manifest is no longer refused because the machine was busy.** The checker runs each regular
  expression against lines built to hurt it, with 40 milliseconds to answer, and the clock that cuts it off fires when
  its thread is not scheduled as much as when the expression is slow. A line is now tried three times and an expression
  is called slow only if it is on every try; a backtracking one is still cut off each time, and still refused.

### Upgrading

One migration, which `panel migrate` applies and which moves no data: a DNS provider gets a column for a webhook's
address, empty for the provider you have. A saved bucket is untouched; saving one again with an Amazon or Backblaze
endpoint and the wrong region is now refused with the right one. See [docs/upgrading.md](docs/upgrading.md).

## [0.7.0] — 2026-10-03

**A Minecraft server is reached by its name alone, and the panel keeps a month of what a server and
a node have been doing.** Two things that do not depend on each other: the records behind an address —
IPv4, IPv6, and an SRV record that carries the port — and the history of servers and nodes, now with the
network in it.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.1, 0.5.0 or 0.6.0.** The
agent in 0.7.0 is the 0.4.1 agent with its version moved, because a release tags the panel and the agent
together. The network figures the new charts draw were always in what the agent returns; the panel
threw them away.

### The address

- **An SRV record for Minecraft: Java Edition, on Cloudflare.** Given a name with no port, the Java client
  asks DNS for `_minecraft._tcp.<name>`. The panel now writes that record, `0 5 <port> <name>`, with the port of
  the block the server holds, and keeps it: written as the server is created, moved to the new port when the
  server moves, removed with it. A second Java server on a node, which holds 25568 and not 25565, and one that
  moved to another node, are reached by the name alone, and the server's page says *found by SRV* beside the
  port and shows the name without it. DuckDNS cannot hold an SRV record, and there a Java server is `name:port` as
  before. Bedrock's client does not look one up. A community game's manifest cannot ask for one: it would write
  into the owner's own zone. See [docs/servers.md](docs/servers.md#dns).
- **IPv6.** A node has a *Public IPv6 address* beside its public address, set in *Configure*. With one, every
  server on it gets an AAAA record beside its A record — at Cloudflare as a record, at DuckDNS as the subdomain's
  IPv6 address — and loses it again when the address is taken away. **It is never guessed:** the address the
  panel observed is not taken for the other family, since nothing says the Internet can reach it. An A and an
  AAAA at one name used to be refused as *two records*; they are now decided each on its own.
- **One row for each record.** A server's record was four columns for one address; it is now a table with a row
  for each of A, AAAA and SRV, each with the name it is at, so a record is removed from where it was written even
  after the server's address changed. The DNS page lists them, the server's page names them, and the API's `dns`
  carries `records` and `byName`, and the server's `address` carries `srv`. The wizard's review says what the
  players will type.

### History

- **Network, and thirty days, in the charts.** A server's *Resource usage* is now CPU, memory, network and — once it
  has been measured — the world's size, one panel for each, each with a scale and axis of its own rather than two
  scales on one chart; a crosshair that reads every panel at one moment; the peak beside an average; a gap where
  the server was not running; and a table of the same numbers under it. Windows are 1 hour, 6 hours, 24 hours,
  7 days and, new, 30 days.
- **A node keeps its history.** CPU, memory, storage and the round trip from the panel, for thirty days, in a
  chart on the node's page. A node the poller could not reach has a gap where it was silent.
- **Two API routes.** `GET /api/v1/servers/:id/metrics` and `GET /api/v1/nodes/:name/metrics`, with
  `?range=`, at most 120 buckets with the units in the names. The first is under `metrics:read`, which until now opened
  nothing; the second under `node.read`. The documentation had promised metrics history as server-sent events under
  `/api/servers/:slug`; there were none, and it no longer says so.
- **Read where the rows are.** A chart's buckets are made by the database and not by the page: the week of one
  server that took 160 ms to read took 20, and the thirty days the new window needs take about 190.
- **Docker's network counters start again at every restart**, which the panel measured and takes account of: a
  restart is not a drop to nothing and not a day's traffic in one sample.
- `tps`, which was written as the constant 20 and read by nothing, is gone.

### Also

- **`npm run manifest:check`**, from a checkout, runs the community-game checker on files and directories, with
  `--registries` and `--json`, and exits 0, 1 or 2. It is for somebody writing a manifest with no panel to paste it
  into, and for a repository that collects them. It came after the `v0.6.0` tag.
  See [docs/community-games.md](docs/community-games.md#checking-a-manifest-without-a-panel).
- **Palworld's parked definition** named a query port it did not have, which the registry's audit would have refused
  had the game been offered. It has the port, and every definition, parked ones included, is now held to the audit.
- `GEEBOARD_SAMPLE_MS` was documented as the agent's sampling interval and drove nothing; the documentation says so.

### Upgrading

Two migrations, which `panel migrate` applies. **The first moves data**: each server's written DNS record is
copied into the new table before the four columns are dropped, and nothing is written to or asked of a provider.
**Back up the database first**, as for every release: the columns do not come back. The second adds the network and
disk columns to the samples, a table of node samples, and the fields network counters are differenced from, and
drops `tps`. History from before the upgrade has no network figures. A node's *Public IPv6 address* is empty,
and nothing changes about a record until somebody sets one; Minecraft: Java servers on Cloudflare get their SRV
record on the poller's next pass. See [docs/upgrading.md](docs/upgrading.md).

## [0.6.0] — 2026-10-03

**A game somebody else wrote can run on your nodes — if an owner has read what it
would do, an authenticator code says yes, and the machine agreed.** Community
games: a *manifest*, which is a game definition in JSON naming a container image,
proposed from a page, approved by an owner, and placed only on a node whose
machine said it will take one. Nothing is fetched from the Internet to make one.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.1 or
0.5.0.** The agent in 0.6.0 is the 0.4.1 agent with its version moved, because a
release tags the panel and the agent together; the node's page says *contract 1*
beside its version. What the agent already refused it still refuses — it builds
every container from a fixed list of options, and a test now holds that list.

### Community games

- **A manifest is a game definition, as JSON.** The eight games Geeboard ships all
  survive that round trip unchanged, so there is no second format. A new page,
  **Games → Community games**, for owners and admins, takes one pasted or chosen from a
  file, checks it, and says what is wrong with it by the path of the field —
  `versions[0].image` — or keeps it as a *revision* that is waiting. A waiting revision
  runs nothing, is in no wizard and is on no node. See
  [docs/community-games.md](docs/community-games.md), which has the format, the rules
  and why each is there, and a real example: Factorio.
- **An owner approves, with a fresh code from their authenticator**, after a page shows
  what it would do rather than what it says it is: the image to its digest, the
  arguments and environment it starts with, the ports and who can reach each, the
  folders, the limits, every word typed at its console, the files written, every
  setting and where it lands, every regular expression, and — in plain sentences — what
  an image can and cannot do on the node. The approval is bound to the SHA-256 of the
  manifest that was read, and the manifest is checked again at that moment. Only an owner
  can approve; an admin can propose, turn one down and retire one. **No API key can do
  any of these.**
- **Revisions and retiring.** A newer revision replaces the approved one when it is
  approved; there is never more than one. *Retire* takes a game out of the wizard,
  templates and clones; its servers keep running and can be managed, and say
  *community · retired*. A retired game can be proposed again.
- **In the wizard, the Games page and a server's page it says *community*.** On the
  placement step a node that has not agreed is listed as *cannot run this game — Missing
  Community games*.
- **The API** lists a community game with `"community": true`, `"official": false` and the
  `revision` that is approved, by number and hash. There is no route to propose or approve
  one.

### What a manifest cannot say

- **An image is named by its digest.** `registry/name:tag@sha256:…`: a tag moves and a digest
  cannot, so what an owner read is what runs. The registry has to be on the owner's list,
  `docker.io` and `ghcr.io` to begin with, which the owner can change; the agent would pull from
  anywhere, so the panel holds this line.
- **No mods, no download, no Steam branch**, versions only from the manifest, install only
  from an image. No port the panel, the agent, the proxy or the machine use, none below 1024.
  No file written outside the server's folder, no variable that begins `GEEBOARD_`, no
  setting written into a JSON file (the panel cannot write one yet, and a game approved and then
  not creatable would be worse than a refusal). A field the panel does not know is an error.
- **Every regular expression is checked three times.** A static rule at proposal (no
  back-references or look-behind, bounded repeats, no repeat inside an unbounded group), a
  timed run against lines built to hurt it at proposal and again at approval, and a guard at
  run time for the patterns of an approved game: each line cut to 2000 characters, each
  match stopped after 25 ms. `^(a+)+$` freezes the panel for 22 seconds on 32 characters;
  none of the 36 patterns Geeboard ships fails the rule.

### Nodes

- **A node takes a community game only if its machine says so.** The capability is
  `community-games`, declared on the machine: `--community-games` on the Linux installer,
  `-CommunityGames` on the Windows one, which are `--capabilities community-games` for the
  join. **The panel has no switch for it**: *Add a node* offers no checkbox and its command
  never carries the flag. The pending-node card and the node's page say what it means. A node
  that already joined adds it to what it declares, as
  [docs/community-games.md](docs/community-games.md#the-node) says.
- **`deploy/linux/container-firewall.sh`**, new, closes the node's side: a container no longer
  reaches `169.254.169.254` (the cloud provider's metadata service), or the node's SSH and
  agent ports. Three rules, each commented so `remove` takes away exactly what `add` put;
  `status` says which are present. Tested on a real Linux machine before and after, with a
  game's published port, DNS and the Internet unaffected. It is not run by the installer.

### What this does not do

- **It is not a sandbox, and the approval page says so.** An approved image runs as root in
  its container with Docker's default capabilities and reaches the Internet and the node's
  own network: measured from a container on a real node, the node's SSH, the agent's port,
  the proxy and the cloud metadata service all answered. That is true of every game Geeboard
  hosts. A digest says which bytes run and not what they do.

### Upgrading

One migration, which `panel migrate` applies: two tables, for the revisions of community
games and for the owner's list of registries. Nothing changes until somebody proposes a game,
and no node declares `community-games` after an upgrade. Two permissions are new —
`community.propose` for owners and admins, `community.approve` for owners — and in no API scope.
See [docs/upgrading.md](docs/upgrading.md).

## [0.5.0] — 2026-10-02

**The panel can tell you what it knows, and a server that went well can be used
again.** Two things that do not depend on each other: notifications to Discord and
to webhooks, and templates of your own with a clone of a server.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.1.**
The agent in 0.5.0 is the 0.4.1 agent with its version moved, because a release
tags the panel and the agent together; an agent that is already running goes on
working, and the node's page says *contract 1* beside its version.

### Notifications

- **Discord and webhooks, for six things that need a person.** A server crashed
  (with whether the panel restarted it), the panel gave up restarting one, a node
  went offline or came back, a backup failed or is damaged, an update is available.
  A new **Notifications** page, under Infrastructure and for owners and admins, adds
  a channel: pick Discord or a webhook, paste its address, tick what it should hear
  and send a test; it is saved only if the test goes through. With no channel nothing
  is sent and nothing about a server changes. There is no email: the project has no
  mail server. See [docs/notifications.md](docs/notifications.md).
- **They are made from what the panel already writes to its audit log**, after the
  fact, so nothing that starts or stops a server knows about them. A crash the panel
  puts right is one message and not two; servers that fall over together because a
  host restarted are one message naming them; a backup that failed because its node
  is down is not sent as a second alarm; a channel is sent at most ten messages a
  minute, with one notice saying how many were held back. A server that stops without
  crashing — somebody typed `stop` at its console — is not announced, since the panel
  cannot tell it from one that went wrong.
- **Delivery is at least once**, from the poller, beside its pass and not in it: a
  failure that could pass is tried again after a minute, five and thirty, one that
  would not is final, and a message a day old is not sent. The page lists the latest
  messages with their state and why.
- **A webhook's messages are signed.** `X-Geeboard-Signature` is an HMAC-SHA256 of
  the timestamp and the body with a key made with the channel and shown once; the
  JSON is documented and changes only by adding. A Discord message is an embed that
  cannot ping anybody or carry a link of its name's choosing.
- **Update available is now a fact the panel records**, once for each server and each
  version it could move to, written as a *server.update.available* line after each
  catalog sync. It was a calculation made when a page was drawn.

### Templates and cloning

- **Templates of your own.** *Reuse this server*, on a server's Settings page, keeps
  its settings, limits and version under a name; the new **Templates** page, under
  Catalog, lists them, and *Create a server* on one opens the wizard on its game and
  version with those values. A template does not keep the world, the players, the
  address, the schedule, a join password, or a setting that names a file in the
  server's own folder (Terraria's world file): the page says which it left behind.
  Deleting one touches no server made from it. See
  [docs/servers.md](docs/servers.md#templates-and-cloning).
- **Clone a server.** *Clone* opens the wizard filled in from a server, named *… copy*.
  With an off-site bucket set up, the review step offers to copy the world too: a
  backup of the source goes into the bucket and is restored into the new server, with
  the source left running. It is two steps and not one — if the world cannot be put
  in, the new server stays, on the world it was created with, and the message says
  why. Without a bucket the copy gets the settings and a new world. A server made from
  a template or a clone says so in its creation line in the audit log.

### Security

- **A webhook may not call just anything.** The panel calls a webhook from inside its
  own network, where the database, the agent and a VPS's metadata service answer, so
  Discord is accepted only at the addresses Discord issues and a webhook only over
  `https` to public addresses. A name is looked up once, every address it gives is
  judged, and the call goes to one of them — not to a second lookup, which is how DNS
  rebinding walks round a check. A redirect is never followed, the answer is read for
  its status and no more, and a failure says a fixed phrase and the host, never the
  address or the token. This machine itself and link-local or cloud metadata addresses
  are refused in every spelling and in every setting.
- **`GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1`** is the one thing that widens it, for ntfy or
  Home Assistant on the LAN: private networks, and plain `http` there. It is set in the
  panel's environment by the person who owns the machine and is not a setting on a
  page, on purpose. The compose file passes it through, empty by default.
- **The off-site bucket's address gets the same guard.** It was called, signed, at
  whatever an owner or admin typed, with a few lines of the answer shown in the error.
  Now link-local and cloud metadata addresses, the unspecified address and the
  multicast and reserved ranges are refused, and no redirect is followed; a store on
  this machine, in the same Docker network or on the LAN — the usual way to run it —
  is unaffected. An endpoint saved before this that falls in a refused range is not
  deleted: the panel will not call it, and says so when the bucket is checked.
- **`rekey` covers the new secrets.** A channel's address and a webhook's signing key
  are sealed with `SECRETS_KEY` and re-sealed with it; `verify:rekey` proves both.

### Upgrading

Two migrations, which `panel migrate` applies: the notification channels, their queue
and cursor, and a column for the update each server was last told about; and the saved
templates. Nothing is sent until a channel is added. A new optional variable,
`GEEBOARD_WEBHOOK_ALLOW_PRIVATE`, is passed through by `deploy/panel/docker-compose.yml`.

## [0.4.1] — 2026-10-01

**Closed gaps, and no new feature.** This is 0.4.0 made sturdier, found by reading
the code and then by trying to break it; `docs/roadmap.md` has what was measured.
Same release line as 0.4.0.

**Agent contract: 1, reported for the first time. No agent upgrade is needed from
0.4.0.** An agent on 0.4.0 is on the same release line as this panel, so it stays
compatible; it does not send a contract until it is upgraded, and is judged by its
line until then. The agent in 0.4.1 is the 0.4.0 agent plus the number.

### Nodes

- **Agents are told apart by a contract number, not by the release they are.** The
  release-line rule made every minor an upgrade of every agent, including the ones
  that had not changed — 0.4.0 shipped an agent with no code change in it because
  the panel's line had moved. The agent now sends an integer, its *contract*, with
  its version: in its registration, in every heartbeat and in `GET /version`. The
  panel works with an agent that speaks the same number, whatever release it is, and
  only raises its own when a panel and an agent one number apart would misread each
  other. An agent that sends none — every one up to 0.4.0 — is judged by its release
  line exactly as before; the first upgrade to 0.4.1 or later is the last one that
  rule forces on it. The node's page shows the contract after the version, the
  column `nodes.contract` holds it, `GET /api/v1/nodes` has it as `agentContract`,
  and every refusal and banner says which of the two criteria decided. One migration
  adds the column. See [docs/nodes.md](docs/nodes.md#panel-and-agent-versions).

### Servers

- **An address is a name, and has one owner.** Creating a server stored its
  address as typed and compared it exactly, so `Aurora.example.com` and
  `aurora.example.com` made two servers on one name — which, with a DNS provider,
  is two servers fighting over one record — and two creates at the same moment on
  different nodes both went in, five pairs in six. The address is lower-cased
  where it is written now, and the database refuses a second one. The one who loses
  is told *Address in use*. A lost port is tried again instead of being reported as
  "just taken", which is what it was being read as.
- **A create the panel did not live to finish is an error, not "Installing" for
  ever.** If the panel was stopped in the middle of a create, the server's row said
  `INSTALLING` with no workload, and nothing read it again: no error, nothing to do.
  After ten minutes without its row being written — a live create writes it every
  second and a half during a download — the poller turns it into an error that says
  where the create had got to and what to do: delete it from its Settings page, which
  clears what the node was left holding, and create it again. Nothing is deleted for
  anybody, and the audit log has a line for it. Only a create; see
  [limitations.md](docs/limitations.md#interrupted-operations).
- **The migration stops if it would have to choose.** If two servers already share
  an address, case aside, `panel migrate` stops with their names and does nothing
  else: change the address of all but one of each in the panel, and run it again.
  Otherwise it lower-cases the addresses it finds.

### Node terminal

- **No terminal over plain HTTP across the Internet.** A terminal carries what is
  typed and what the shell prints, passwords included, and the panel reaches most
  agents over plain HTTP — which was fine on a private network and is not across the
  Internet, and nothing stopped it. An agent reached with `http:` at a public address
  now gets no terminal: the page says why and what to do, before any code is asked for.
  A private or loopback address is still allowed over `http:`, and `https:` is allowed
  anywhere. A name, which can point anywhere, is treated as a public address over
  `http:` — `localhost` too: register such a node by its IP address, or put TLS in
  front of its agent. **A node with a public address has a terminal only if its agent
  is reached over HTTPS.** See [docs/security.md](docs/security.md#node-terminal).

### Security

- **`rekey` changes the key stored secrets are sealed with, without losing them.**
  Editing `SECRETS_KEY` used to make every stored secret unreadable at once — the
  nodes' tokens, the off-site bucket's key, the Steam key, a DNS provider's token, every
  account's two-factor secret — and the only way out was to register every node again
  and set the rest up again, so in practice the key was never changed. `panel rekey`
  seals them all again under a new key in one transaction, and the agents need nothing.
  It stops and changes nothing if any value does not open with the current key, or one
  changes while it runs; `--dry-run` says what it would do; the new key comes from the
  environment and is printed nowhere. See [security.md](docs/security.md#changing-secrets_key).
  In development, where `SECRETS_KEY` may be left out and `SESSION_SECRET` stands in for it,
  rotating `SESSION_SECRET` has the same effect as editing the key: the security page says so.
- **A server action from another origin is refused, and a test now holds it there.** The
  panel's own route handlers that take the session cookie check the origin themselves —
  they are the four of the terminal — and everything else is a server action, covered by
  Next's check. That was measured, not assumed: a foreign origin and the opaque `null` of a
  sandboxed frame are refused before the action is looked up. `verify:terminal` keeps it so.

### Accounts

- **Expired sessions are removed, and Members counts only live ones.** A session
  that had expired was never deleted: the only removals were a person signing out,
  changing a password or ending their sessions, so the table grew by a row for every
  sign-in for ever, and the Members page counted the dead rows beside the live. The
  poller now removes them once an hour, and the count is of the ones that can still be
  used.

## [0.4.0] — 2026-09-30

**DNS records kept for you, and a member who is somebody a server was given
to. Upgrade every node, after the panel.** The agent has no change of its own in
this release — it is the `0.3.5` agent — but a panel and an agent work together
when they share a release line, and this is a new one, so a `0.4` panel and a
`0.3` agent do not. In this order:

1. **The panel**, as [Upgrade](docs/upgrading.md) says: back up, fetch
   `v0.4.0`, run `panel migrate` — one migration: a table for the DNS provider,
   three columns on a node for where players reach it, four on a server for its
   record — and restart.
2. **Every agent**, on its own machine: `sudo bash deploy/linux/install.sh` on
   Linux, `deploy\windows\install-node.ps1` on Windows, both with no arguments.

In between, each node is a line behind, and that is expected: the heartbeat never
refuses an agent, the node stays in service, and **its servers keep running**. Its
page says *This node runs agent 0.3.5, and the panel is 0.4.0*, the create wizard
greys it out and puts nothing new there, and an update, a rollback, a rebuild and
**Ask the node** on it are refused until its agent is upgraded. An agent upgraded
before the panel is the one order that does not work.

**If you have members**, they see less from this release: the servers given
to them and nothing else of the workspace. Until now a member read every
server's page, the node list, the member list and the whole audit log, and
could act on nothing — a server's owner is whoever created it, and members
cannot create. Owners, admins and moderators are unchanged.

**If you want the panel to write DNS records**, set a provider on the new DNS
page under Infrastructure: DuckDNS with the account's token, or Cloudflare with
a token that has Zone:Read and DNS:Edit on one zone. Nothing is written until
you do, and nothing changes if you never do.

### DNS

- **The DNS page walks you through the provider you chose.** Pick DuckDNS or
  Cloudflare and the steps beside the form are that provider's: where the token
  is, what to make there, what to paste here, and what to do to a server. Each
  is ticked from what the panel holds, never from a timer. Below, four counts —
  written, waiting for a node's address, needing attention, and yours — and
  every server's record with its state. **DuckDNS's API cannot make a
  subdomain** (its specification has a call to update a record and one to
  update a text record, and no more), so a server whose subdomain is not in the
  account says *make it on duckdns.org* beside a button that copies the name;
  Cloudflare needs nothing made first.
- **The create wizard checks the address you type.** Under *Name and address*, a
  moment after you stop typing, the panel looks the name up and tells you what it
  comes to: already at one of your nodes, not created yet, pointing at a machine
  that is not a node, or — with a provider set — a name Geeboard will write, one
  outside the zone that is yours to make, or no node with an address to point at.
  With no provider set, a name that does not exist or points elsewhere gets a
  friendly offer, *Want a name of your own?*, that opens the DNS page in a new tab
  and leaves the draft as it is. A lookup that could not be made says so and
  never blocks creating the server.
- **DuckDNS: one subdomain per node is enough.** DuckDNS answers for every name
  under a subdomain of your account with that subdomain's address, so a server
  can be `aurora.myserver.duckdns.org` without making `aurora` on their site. The
  wizard proposes names under the subdomain the token was checked with; the panel
  writes the record through the subdomain; servers on one node share it, a server
  on another node is told it needs its own, and the last one to be deleted clears
  it. A name straight under `duckdns.org` works as before.
- **A server's address gets its record written.** With a provider configured,
  a server whose address is under its zone gets an `A` (or `AAAA`) record
  pointed at its node when it is created; the record follows the server when
  it moves and the node when its address changes, is rewritten when the
  address changes on the Settings page, and goes with the server when it is
  deleted. A record the provider will not write is never a reason the server
  is not created: the toast says so, the server's page shows it, and the
  poller tries again every five minutes. See
  [servers.md](docs/servers.md#dns).
- **Where players reach a node** is a fact of the node now: *Public address*
  in **Configure** on its page, or the address the panel sees its heartbeats
  come from, used only when it is public. The node's page says which, and
  when neither is known.
- **A record that is already there** with the same address is adopted; one
  that points elsewhere and is not the panel's is left alone and reported,
  never overwritten. Cloudflare records are written unproxied — the proxy
  does not carry a game's ports — with a comment naming the server.
- **The token** is checked against the provider before it is saved, stored
  encrypted, never shown again, and in no API-key scope; a Cloudflare check
  proves DNS:Edit by writing and removing a `TXT` record under the zone.
  `dns.configured`, `dns.checked`, `dns.removed` and `server.dns.*` are in the
  audit log, with addresses and never the token.
- **The API** says how each server's record stands in a `dns` field on every
  server. See [api.md](docs/api.md).
- **The wizard** proposes an address under the provider's zone, and its hint
  under *Address* says whether the record will be written or is yours.

### Accounts

- **A server can be given to an account.** The *Owner* card on a server's
  Settings page, for owners and admins, hands it to somebody; the audit log
  records `server.assigned` with who it was and who it is. A member sees the
  servers given to them, starts, stops and restarts them, and watches their
  console; a moderator given a server gains its settings, files, backups and
  schedule, as for one they made. Removing an account that owns servers has
  always asked for this first, and there was no way to do it.
- **A member sees only what a member can open.** The sidebar lists Dashboard,
  Servers, Console, Players and Games for them, and their dashboard is their
  servers; every other page says whose it is to whoever types its address. A
  member holds no API key.
- **The API follows.** `POST /api/v1/servers/:id/assign` under
  `servers:manage`; `GET /api/v1/servers` answers a member with their servers
  rather than a 403; a server not theirs is `NOT_FOUND`. See
  [api.md](docs/api.md).

## [0.3.5] — 2026-09-28

**A shell on a node's machine, from the panel; and a node that arrives with
less to paste.** Additive on the `0.3` line: a `0.3.5` panel works with every
`0.3.x` agent, and a `0.3.5` agent with every `0.3.x` panel. The panel has
two migrations for `panel migrate` — a column for what each machine says about
its terminal, and one for why the panel could not reach a node. Upgrade the
panel as [Upgrade](docs/upgrading.md) says, then the agents: a node whose
agent is older is shown as *agent too old* on the Terminal page, and nothing
else about it changes.

**If you want a terminal on a node**, switch it on at the machine and restart
the agent: `sudo bash deploy/linux/install.sh --terminal` on Linux,
`install-node.ps1 -Terminal` on Windows. Nothing in the panel can do it. See
[nodes.md](docs/nodes.md#node-terminal).

### Node terminal

- **Terminal**, under Infrastructure, opens a shell on a node's machine as the
  account its agent runs as: PowerShell on Windows, `/bin/sh` inside the
  agent's container on Linux — the page says which, above the terminal. A
  real terminal (resizing, colours, Ctrl-C), not a console: what a machine
  allows, who may open it, and what is recorded are all narrower than a
  game console's, and written in [security.md](docs/security.md#node-terminal).
- **Off until the machine says otherwise.** `GEEBOARD_TERMINAL=1`, the
  installers' `--terminal` / `-Terminal`, `join --terminal`, or `npm run
  terminal -- on`. The node reports the switch in every heartbeat, and the
  Terminal page says *off*, *unavailable* (with the agent's reason) or
  *agent too old* before any code is asked for.
- **Owners only, with a fresh authenticator code each time.** `node.terminal`
  is the one permission an admin does not share, and it is in no API-key
  scope. A session belongs to the sign-in that opened it, and closes when that
  ends, when the role changes, when the node's token is rotated, after fifteen
  idle minutes, after four hours, or when the agent stops — with the reason as
  its last line. A page reload within thirty seconds picks the shell back up.
- **Nothing typed or printed is kept.** The audit log has *node.terminal.opened*
  and *closed* — node, who, shell, duration, reason, bytes each way — and
  *refused* for a wrong code.
- **The agent** gains `POST /terminal`, `DELETE /terminal/:id`, a WebSocket
  at `/terminal/:id/stream` that takes the token in its header only, and one
  dependency, `@homebridge/node-pty-prebuilt-multiarch`, whose Linux binaries
  are in the package and whose Windows binary is fetched when the agent's
  packages are installed. When a session ends, everything the shell started
  ends with it. See [daemon/README.md](daemon/README.md#the-node-terminal).
- The console's socket from panel to agent now carries the token in the
  handshake's header rather than its URL. An agent keeps taking the old form
  from `0.3.0`–`0.3.4` panels.

### Nodes

- **Add a node follows the machine the whole way in.** The dialog draws four
  steps from facts the panel holds — the token used, registered, approved,
  reached by the panel — and stops only when the node is in service or the
  token is spent. It shows how long the token is good for, and, when the
  panel's call to the node's address fails, why, in the words the attempt
  failed with, with the two things that fix it. Until now that reason went
  only to the agent's log and the dialog stopped at *registered*.
- The node's page shows the same under **The machine**: *Not reached*, with
  the reason, beside *Reached*; and *Terminal*, with what the machine said.
- **The panel's own machine can be a node, from the installer.**
  `install-panel.sh` ends by asking *Run game servers on this machine too?*
  (`--node` / `--no-node`, `--node-name`; *no* under `--yes`), mints the
  token itself through the new `node-token` verb and runs `install.sh`, so
  the node registers with nothing pasted. It lands as `PENDING`, like every
  node. Run again on a machine that is already a node, it upgrades the agent
  instead of registering it twice. Proved on a clean Ubuntu VPS, end to end,
  with a Terraria server created on the node it made.
- The panel image has one more verb, `node-token <name>`, which prints a
  registration token once. Whoever can run it as the panel is already the
  administrator; the audit log names the installer.

### Known limitations

- Nothing yet refuses a terminal on an agent the panel reaches over plain
  HTTP across a network that is not yours; a rule for it is planned as its
  own change. Until then, see [security.md](docs/security.md#known-gaps).

## [0.3.2] — 2026-09-26

**What an account could read of a server that was not theirs.** Every account
sees every server's page, and was given more on the way than the permissions
say: a member read its console and the commands typed into it, and a member or
a moderator read its join password and its backups. A moderator still watches
every console and reads every command, as the permissions have always said.
Only the panel changes: a `0.3.2` panel works with every `0.3.x` agent, and
there is nothing for `panel migrate` to do. Upgrade the panel as
[Upgrade](docs/upgrading.md) says; the agents stay as they are.

**If a join password was changed from the panel before this**, the audit log
has it, as it was and as it became, readable by every account. Nothing removes
those lines; change the password again if they matter.

**An API client may be given less than before**, never a different shape: a
join password only with `server.settings.write` on that server (a key needs
`servers:write`), and a console command's text only with `server.console.read`
(a key needs `console:write`). What was left out is named in new fields —
`hidden`, `hiddenSettings`, `targetHidden`. See [api.md](docs/api.md).

### Console

- **The console page and a server's last lines were open to anybody signed
  in.** A member sees every server's page and may watch only their own
  server's console, and the stream refused them — but the console page loaded
  a thousand lines of any server named in its address, and a server's page
  showed its last six, to anybody. Both ask first now, before the node is
  asked anything, and say why there is nothing to show: *No console access*.
  **Console** in the sidebar takes a member to their own server rather than to
  a refusal for somebody else's.
- **A crash quoted the console to everybody.** A server made unhealthy by a
  line matching its game's crash pattern showed that line on its page. To
  somebody who may not watch that console, the page now says the line is in
  the console instead of quoting it.
- **An open console is asked again every ten seconds.** It was asked once,
  when it opened, so a role taken away or a session ended from the account
  page left it streaming for as long as the tab stayed open. It closes now,
  says why — *Your role is now member, which does not watch this server's
  console* — and clears what it showed.
- **The console's stream did not ask for two-factor.** An owner or admin who
  had not enrolled, sent to the account page by every page, could still open a
  console's stream by its address, download the audit log as CSV, and read the
  create wizard's progress. All three ask now, as the pages do, and the export
  asks for `audit.read` too.

### Settings

- **A join password was on every account's Settings page.** Terraria's,
  Zomboid's and Valheim's server password were in the game's form for anybody
  who opened it, read from the panel and from the server's own files, and in
  `GET /api/v1/servers/:id` and `…/settings` for any key that could read the
  server. It is given now only to whoever may change the server's settings;
  anybody else sees *Hidden*.
- **The Settings page looked editable to people who could not save it.** A
  member or a moderator on somebody else's server gets both forms without their
  Save buttons, and a sentence saying who can change them; the Danger zone,
  which counted the server's backups, is drawn only for whoever may delete it.
- **A changed password was written into the audit log.** It is recorded as
  changed now — *Server password: not recorded → changed* — and never as what
  it was or became. A definition's password field has to say it is secret, or
  the registry refuses the game.

### Backups

- **Every account saw every server's backups.** The Backups page and a
  server's own page listed them, names and failures included, to anybody; the
  API already asked for `server.backup.read`. Both pages ask now, and say whose
  backups they are. The workspace's totals — how many are kept, how much of
  the nodes' disk they take — are shown to whoever may list every backup. The
  audit log still records each backup taken, as it records everything done to
  every server.

### Audit log

- **Every account read every command typed into every console.** A command's
  text is shown now to whoever may watch that server's console, on the Audit
  and Activity pages, the dashboard, the CSV export and the API, and the search
  does not look inside a text its reader may not see. The line stays — who sent
  a command, to which server, when — with *command not shown* in place of it.

## [0.3.1] — 2026-09-26

**Fixes from a production Terraria server, on the same release line.** A `0.3.1`
panel works with a `0.3.0` agent and the other way round, and there is nothing
for `panel migrate` to do. Upgrade the panel as
[Upgrade](docs/upgrading.md) says, then the agents when you can: three of the
fixes are theirs — an upload that arrives short is refused before it replaces
anything, the console carries the time each line was printed, and a console
left open across a restart goes on. Coming from `0.2.x`, the
[0.3.0](#030--2026-09-25) upgrade applies as written: the panel, then every
agent.

**If a Terraria world failed to load**, it was probably cut at 10 MB on the way
in: see the first item below. After upgrading, upload it again from Files — its
row gives the exact bytes on hover — and choose **Use as world** on it.

### Files

- **Uploads over 10 MB were cut at 10 MB, and called uploaded.** Next.js keeps
  a copy of every request body its proxy sees, up to 10 MB, and past that ends
  the stream without an error; the file was written as far as it went and the
  panel answered `201`. Measured: 20 MB sent, 10,485,760 bytes on the node. The
  upload route is out of the proxy now, and 4, 20 and 60 MB arrive whole.
- **What arrives is counted.** The browser's `Content-Length` goes to the node,
  which refuses a body that ends short before it renames anything — *the upload
  ended at 1000 of 11932207 bytes, so nothing was written* — and the file that
  was there stays. With an agent before 0.3.1 the panel finds the short file
  afterwards and removes it, saying the old file of that name is gone.
- A file's size shows its exact number of bytes on hover.
- **A file a game can use has the button for it.** A Terraria world at the root
  of the server's folder has **Use as world** on its row, or *in use*.

### Servers

- **Terraria's world is a setting: World file.** It was a fixed line,
  `world=/data/geeboard.wld`, written again at every save, so an uploaded world
  could be opened only by editing `serverconfig.txt` by hand until the next save
  put the line back. A world file name is all it takes, and a path is refused:
  `world=/data`, found on a production server, made Terraria generate a new
  world and fail to save it. `worldpath=/data` stays fixed. A server whose file
  names another world by hand shows it on the Settings page as a change on the
  node; one that names nothing opens `geeboard.wld`, as before.
- **A server that stops because of something it printed says what.** A
  definition can name lines that mean a server cannot work, with the sentence to
  show. Terraria's are *Load failed!* — a world it could not read to the end,
  after which it exits with code 0 and the panel said *Stopped* and nothing more
  — and *Failed to create the file* — a world it cannot save, after which it
  says *Server started* and the panel said *Running*. The first is now *Stopped*
  with the reason on the server's page and in the audit event; the second is
  *Not healthy* with the reason, at once, inside the boot grace too.

### Console

- **A line shows the time it was printed, in your own clock.** Every line was
  stamped when it reached the browser, so each reload moved the whole backlog to
  that moment, and the time was formatted on the server, in UTC. A downloaded
  log dates every line and says in its first line which clock it is in.
- **A line is shown once.** The stream's opening copy of the last hundred lines
  was added again under the page's, and again at each reconnect; a downloaded
  log had a hundred lines twice. Lines with the same time and text are one.
- **A restart goes on in the console that watched it.** The node's log stream
  ended when the server stopped and nothing followed the next run; the console
  stayed quiet until the page was reloaded. The agent follows the next run from
  the last line it sent.
- **Lines split across two reads were lost.** The agent dropped a log frame that
  a read ended inside, and the one after it; under a boot printing thousands of
  lines that was runs of them. Frames are carried across reads now.
- **Progress is folded.** Runs of lines that differ only in their numbers show
  as their last, one per kind — *Resetting game objects 100%* where there were a
  hundred lines — so a boot and its error fit the page. The page reads the last
  thousand lines, the overview's six come from as many, and *last 6 lines* shows
  six, not five.
- **Geeboard's health check is marked.** Terraria logs each check as a
  connection from the node's Docker bridge, booted for its version, which read
  as somebody trying to get in every five minutes. Those lines are dimmed and
  tagged **Geeboard health check**.
- Stack-trace lines are no longer levelled `CHAT`, the exception they name is an
  `ERROR`, and blank lines — Terraria writes byte-order marks to stderr — are
  left out rather than shown as empty `ERROR` rows.

### Fixed

- **The create wizard ticked reasons against its own recommendation.**
  *✓ Agent attached: No agent on this node* and *✓ Not in eu-west*: every reason
  under *Recommended* had a tick. The ones that count against the node are
  marked `!`, in the warning colour. `PlacementCandidate` has `against`, the
  reasons of that kind.
- **A disabled primary button looked ready.** The accent colour at 45% read as
  a button to press — *Save changes* on a Settings page nobody had touched. It
  is grey now.
- **The Settings form refused a rename on a full node, and did not say why.** A
  server whose memory limit is more than its node now has room for could not
  save anything from the form, with no error shown, though the save itself
  allows keeping that limit. The form applies the same rule, and once anything
  has changed every error shows.
- `verify:registration` expected the Linux join command as it was before 0.2.2
  and counted retired games as the catalogue, so it failed on any database that
  had been through a catalog sync.

## [0.3.0] — 2026-09-25

**Upgrade every node, after the panel.** The agent now downloads a server's
build as a job the panel watches, and reads a mod's download in a new shape, and
answers the panel in new shapes for both — so this is a new release line, and a
`0.3` panel and a `0.2` agent do not work together. In this order:

1. **The panel**, as [Upgrade](docs/upgrading.md) says: back up, fetch
   `v0.3.0`, run `panel migrate` — five migrations this time — and restart.
2. **Every agent**, on its own machine: `sudo bash deploy/linux/install.sh` on
   Linux, `deploy\windows\install-node.ps1` on Windows, both with no arguments.

In between, each node is a line behind, and that is expected. The heartbeat
never refuses an agent, so the node stays in service and **its servers keep
running**. Its page says *This node runs agent 0.2.4, and the panel is 0.3.0*;
the create wizard shows it greyed out with the same sentence and puts nothing
new there; and an update, a rollback, a rebuild, a setting that needs a rebuild
and **Ask the node** on it are refused, saying to upgrade the agent. The next
heartbeat after its agent restarts clears all of it. An agent upgraded before
the panel is the one order that does not work.

### Servers

- **The first server of a large game is created at the first attempt.** The
  node gave an image pull two minutes and the panel gave the create three, and
  Project Zomboid's Build 42 image is 2.2 GB to download and 10.4 GB unpacked: on
  a node that had not pulled it before, creating a Zomboid server failed by
  construction, left nothing behind to say why, and worked at the second
  attempt because Docker had gone on downloading behind the failure. A pull is
  now a job of its own on the node, with no time limit — it is stopped only when
  it goes two minutes without moving, and says where it stopped — and the create
  that follows finds the image there.
- **The wizard shows the download as it goes** — *Downloading: 1.2 GB of 2.2 GB,
  8 of 9 layers*, with a bar, then *Unpacking: 3 of 9 layers* — in the layers and
  bytes the node counts from Docker's own stream. The total is shown once it is
  known, which is once every layer has begun; until then the wizard says how
  much has come so far and draws no bar. Its review step no longer promises
  "cached, or a minute the first time".
- **An update downloads the new build before it stops anything**, and shows it
  the same way; a download that fails leaves the server running and untouched.
  Before, the download happened after the server had been stopped. A rollback
  and a rebuild download first too, when the node no longer has the build, and
  all three say what they are doing while they work — backing up, stopping,
  restoring — where the button used to say *Working…* and nothing else.
- **A settings change that needs a rebuild downloads first too**, before the
  old workload is removed. A download that fails there changes nothing: the
  server goes on running, on the settings it had, and the form says so. Before,
  the download came after the removal, and failing twice — once, then again
  putting the server back — left it down and in `ERROR`.

### Nodes

- **`GEEBOARD_PULL_TIMEOUT_MS` is retired.** It bounded a whole pull. Its place
  is taken by `GEEBOARD_PULL_STALL_MS` (default two minutes): how long a pull may
  go without moving, not how long it may take. An agent started with the old
  variable set says so in its log.
- The agent has two new routes, `POST` and `GET /images/pull`, and `POST
  /servers` no longer pulls: an image that is not on the node is refused at
  once, with a `409`. See [daemon/README.md](daemon/README.md).
- **Until a node's agent is upgraded, its servers cannot be updated, rolled
  back or rebuilt**, nor given a setting that needs a rebuild. Each of those
  downloads its build first, which a `0.2` agent cannot do, so the panel refuses
  before asking it and says to upgrade the agent; the servers go on running. An
  agent that reports no version is asked, and its `404` is read the same way.

### Mods

- **Mods load on Build 42.** This closes the limitation in 0.2.4's notes. Build
  42 keeps a mod's `mod.info` in a folder per game version — `42/`, `42.0/` —
  beside a `common/` folder, and the agent read it only at the top of the mod,
  where Build 41 keeps it: on a Build 42 server **Ask the node** left every
  Build 42 mod *waiting* and **Apply** loaded none of them. The agent now reads
  every folder and every `mod.info` in a download, and the panel works out
  which one the server's build reads. **The fix is in the agent: upgrading the
  panel alone does not bring it.** Until a node is upgraded, Ask the node on
  its servers says so instead of answering.
- **A mod the server's build will not load stays out of the load list, and its
  row says why** — *laid out for an older build*, *needs 42.21 or later*.
  Measured on 41.78.19 and 42.20.4: Build 42 reads the highest version folder
  not above its own major.minor, with `common/`, and never the top of the mod;
  Build 41 reads only the top; both honour `versionMin` and `versionMax`.
  Neither refuses to start over a mod it cannot see — it logs "not found" and
  starts without it — so before this, a Build 41 mod on a Build 42 server was
  called loaded here and was not.
- **A mod whose requirement is missing stays out too.** A `mod.info`'s
  `require=` is read once the mod is downloaded, and the game — measured on
  both builds — skips a mod whose requirement it cannot find, and every mod
  that requires that one. The row names what is missing: *needs Erikas_Tiles*.
  Finding the item that carries it is still yours. A mod switched off that
  another switched-on mod requires is loaded by the game anyway, and its row
  says so.
- **The Workshop's tags warn before the download.** A pasted collection says
  what its items are tagged for — *5 for Build 42, 1 for Build 41 only* — and
  marks the ones for the other build; a single mod tagged only for the other
  build is added with a warning. Tags are the author's, so they never refuse:
  the files decide once the game has them.
- A mod whose directory has a space or an apostrophe in its name —
  *BuildingCraft Erika's tiles* is a real one — was skipped by the agent. It is
  read.
- The agent no longer follows a `mod.info` that is a symbolic link.
- `GET /servers/:id/mods` on the agent answers each mod as its directory, the
  folders in it and every `mod.info` with what it declares, rather than `{ id,
  name, poster }` — see [daemon/README.md](daemon/README.md).
- `panel migrate` adds a column, `server_mods.contents`: what the node found,
  kept so an update that moves the game is judged again without asking the
  node.
- **A collection's mods can be removed as one.** A collection adds hundreds of
  mods in a click and they left one click at a time. Each mod now remembers the
  collection that added it — its row says so — and each collection on the list
  has **Remove its mods**, which takes those and nothing else: a mod of it added
  on its own, or brought by another collection, stays. Mods added before this
  have no collection; pasting theirs again counts them as its own without
  moving them.
- **A mod's Workshop requirements are named before the game misses them**, with
  a Steam Web API key. When a mod is added, and when the node is asked, the
  panel asks Steam what the item's page lists as required, and a row whose
  requirement is not on the list names it with **add it**. The list is the
  author's and can be short — measured here, a mod whose page lists nothing
  needs one the node finds — so the node's own check stays. Without a key it is
  not known, because Steam answers it only to the keyed API.
- **The mods have an API**: the list, adding an item or a collection, removing
  one or a collection's worth, switching one off, the order, applying, and
  asking the node — `/api/v1/servers/:id/mods`, under `servers:read` and
  `servers:write`, the tab's own operations. See [api.md](docs/api.md).
- `panel migrate` adds three columns to `server_mods`: the collection a mod came
  from, its title, and what its Workshop page requires.

### Fixed

- **What was done to a server's mods was recorded without the account that did
  it.** The audit log showed *system* for adding, removing and applying mods
  and for adding a collection; each carries its account now.
- **A link pasted into the Mods tab as it opened could vanish.** The tab fills
  its shelf with a search of its own when it opens, and that answer, arriving
  after a pasted collection's preview, replaced it. Only the last question's
  answer is shown now.
- `verify:mods` and `verify:pull` exited 0 when they crashed halfway, reporting
  the checks that had passed until then as all of them. A crash counts as a
  failure.
- **Deleting a server deleted its history from the audit log.** Every line about
  it — its creation, every setting changed, every command typed into its
  console, its backups, its mods — went with the row, and only the line saying
  it had been deleted remained, on a page that says it keeps "every privileged
  action". The lines stay now, named after the server: the Audit
  page shows it struck through and "· deleted", finds it by name, and filters to
  it with **Every event of this server**; the CSV export carries its name, and
  `GET /api/v1/audit` answers it with `"deleted": true` and still finds it by
  its slug. `panel migrate` changes how an event refers to its server and adds
  three columns to `activity_events`; lines already lost are not brought back.
- **A create that failed left nothing behind to say why.** Its row was rolled
  back and the steps it had reported went with it. A `server.create.failed` line
  now stays, with the step it failed at, the node's reason, and what was left
  on the node afterwards — and when the node does not answer the clean-up
  either, the wizard says something may be left there, where it said nothing
  was.
- **The games promised what nothing here does.** Minecraft Java's card offered
  Forge and "the whole modded ecosystem", Valheim's BepInEx mod loading and
  Bedrock's add-on support: there is no Forge version, and nothing installs a
  plugin, a mod or an add-on for any of them. The cards say what the catalogue
  offers and that those are not installed from the panel; Project Zomboid's
  says it takes Workshop mods, which it does.
- **The create wizard described changes that do not work that way.** It said a
  different version later was "a restart rather than a migration" — it is an
  update with a backup first, and another kind, Paper to Fabric or Build 41 to
  42, is refused and needs a new server — and that a server's node could not
  change, when an owner or admin can move it.
- **A mod list applied while the server was starting could be lost.** A
  Zomboid start that downloads mods rewrites the game's settings file once they
  are in, from what it read as it started, so a `Mods` line written in between
  was gone by the time it said *SERVER STARTED* — and in between is when **Ask
  the node** first sees the files, so restart, Ask the node, Apply walked
  straight into it. Apply now writes nothing until the game has said it started,
  and says so.
- **The create wizard could not create anything from a plain-http address other
  than localhost.** It made its progress key with `crypto.randomUUID`, which
  browsers offer only on https and localhost — measured: on this PC's LAN
  address the function is not there, and the click failed before any request
  was sent. The key comes from `crypto.getRandomValues` now, which is there
  everywhere.
- **An update killed the server it was updating.** A rollback and a rebuild stop
  the server with the game's own command before replacing its workload; an
  update did not, and left the stop to the rebuild, which removes the old
  workload by force — so the game was killed where it stood, a moment after the
  backup had saved it, with whatever it was writing half-written. It is stopped
  the same way as the other two now: on this project's machine Docker records
  Paper exiting with code 0 before its workload is removed.
- **Ask the node called a download in progress one with nothing in it.** Steam
  writes an item into its folder as it arrives; one whose `mod.info` has not
  landed yet is *waiting*, as it is.
- **Building the panel no longer asks Google Fonts for anything.** Geist and
  JetBrains Mono are files in the repository now, the same ones the
  documentation site serves, so `docker compose build` and `npm run build` work
  behind a firewall that does not let Google through — and on a day Google's
  answer changes shape, which is what made the development server answer 500
  on every page in CI while the same commit built here.
- **The panel is set in Geist, as it was designed to be.** Its text had been in
  the browser's default sans — Segoe UI on Windows — on every page: the font's
  variable was set on the page's body, and the theme reads it from the root,
  where it did not exist. The monospace was unaffected.

## [0.2.4] — 2026-09-23

**The panel only: no node has to move.** Nothing here touches the agent or the
contract between the two halves, so a `0.2.x` agent works with this panel
exactly as it did — upgrade the panel and leave the nodes alone. It does add one
table, for the Steam key, so this is an upgrade where `panel migrate` has
something to do; [Upgrade](docs/upgrading.md) runs it every time. If you run
Project Zomboid, take it: in 0.2.3 nothing in the panel led to the Mods tab.

### Servers

- **A game's own minimum is advice now, not a bound.** Asking for less memory or
  CPU than a game declares is allowed — in the create wizard, on the settings
  page and through the API — and said where it is asked for: *"Project Zomboid
  asks for 6 GB. With 3 it may fail to start, or run until the world grows and
  then stop."* It was a hard floor in four places at once (the slider, the
  settings field, `createServerOp` and a failed compatibility check), so an
  operator with a small machine and three friends could not ask for a 4 GB
  Zomboid at all. What this catalogue believes about somebody else's hardware
  does not outrank what an operator knows about their own.
- **`cpuPctMin` is checked at last.** Every game in the catalogue declared one
  and nothing read it; under it is now the same warning memory gets.
- What still refuses: the platform's own floor — 1 GB and 50% of a core, below
  which a container is not a server — a game's ceiling, and the node's
  uncommitted capacity, which the review step can still be told to overrule.
  Storage keeps the game's minimum too: a disk too small for the image is not a
  slow server, it is a download that cannot finish.
- `checkCompatibility` returns these as reasons of kind `advice`: failed checks
  that do not make a placement incompatible. `blockers()` leaves them out,
  `cautions()` returns them.

### Mods

- **A Workshop collection can be pasted like an item.** The Mods tab shows what
  is in it — how many mods, how many the server already has, what was left out —
  and **Add** puts the new ones after everything already on the server, in the
  collection's own order. Nothing the server already has moves, or is switched
  back on. Collections it links are followed, with their items where the link
  sits; each item is added once, two collections that link each other are each
  walked once, and past 1,000 items or 50 collections it stops and says so. It
  needs no Steam key, like pasting an item: both questions it asks Steam are
  keyless.
- **Nothing changes on the nodes.** A collection is expanded by the panel; the
  game is still told item ids and the agent still reports what it downloaded,
  exactly as before. No agent upgrade.
- **The Steam Web API key can be set from the Mods tab**, by an owner or admin.
  It is tried against Steam before it is kept, stored encrypted like the
  bucket's keys, and never shown again; the tab says who set it and whether
  Steam still takes it, and a key Steam starts refusing is marked there the
  next time somebody searches. **`STEAM_API_KEY` in the environment still
  works, and wins**: while it is set the tab says so and offers nothing to save.
  To manage the key from the tab, empty that line in `deploy/panel/.env` and
  restart the panel.
- **Upgrade with `panel migrate`**, as [upgrading](docs/upgrading.md) says for
  every release: the key has a table of its own, `workshop_key`.

### Fixed

- **A pasted collection link was offered as a mod.** Steam describes a
  collection as an item of size nothing, so **Add** put the collection's id in
  the list and **Apply** would have written it into `WorkshopItems`, where the
  game cannot download it. A collection now opens as a collection, and adding
  one by its id as a single mod is refused.
- **A link to another game's Workshop item was accepted.** It is refused now,
  with the item's name and why.
- A key Steam refuses is called that — *"Steam refused the key"*, with where it
  came from — rather than *"check STEAM_API_KEY on the panel"*, which was wrong
  whenever the key did not come from there.
- **The Mods tab was greyed out on every server page but its own**, Zomboid
  servers included, so nothing in the panel led to it: only the Mods page told
  the row of tabs that the game takes mods. The tabs now work it out from the
  server's game, on every page.

### Known limitations

- **On Build 42, mods are downloaded and not loaded.** Build 42 keeps a mod's
  `mod.info` in a folder per game version — `42.0/`, `common/` — and the agent
  reads it only where Build 41 puts it. So on a Build 42 server **Ask the node**
  leaves every Build 42 mod *waiting* although the game has downloaded it, and
  **Apply** never puts it in the load list: the server starts, without them.
  Build 41 servers are unaffected. The fix is in the agent, so it comes with
  0.3.0 and a node upgrade rather than in this release.

## [0.2.3] — 2026-09-22

**The installer only.** Nothing here touches the panel, the agent or the
database — it is the shell that installs them, so an installation already
running is unaffected and nothing has to be upgraded to get it. Take it before
installing anywhere new.

### Installing

- **The installer checks the address you give it.** Asked "the address
  browsers will use" one line after a yes-or-no question, an installation
  answered `y` — and was taken at its word: `PANEL_URL` became `https://y`,
  Caddy was configured for a site called `y` and issued a certificate for it,
  and the panel came up perfectly behind an address that does not exist. An
  address now has to be one: an IPv4 or IPv6 address, or a name with a dot in
  it. Digits and dots that are not a valid address — `1.2.3`, `256.0.0.1` — are
  refused as the mistyped addresses they are rather than accepted as hostnames.
  A bad `--ip` or `--panel-url` is refused before the machine is touched at
  all, and the question itself now says that Enter accepts the address in
  brackets.
- **`deploy/lib/verify.sh` is new, and CI runs it.** The panel and the agent
  have verify scripts; the shell that installs them had none, which is how a
  question with an unchecked answer reached a release. Forty-two checks over
  the pure helpers — what counts as an address, the host out of a URL, where
  the panel listens, that a secret already written is never rewritten, that the
  Caddyfile is the template filled in — and a CI job that also refuses an
  installer that does not parse.

## [0.2.2] — 2026-09-22

**The panel only: no node has to move.** Nothing here touches the agent, the
contract between the two halves, or the database schema, so a `0.2.0` agent
works with this panel exactly as it did — upgrade the panel and leave the nodes
alone. See [Upgrade](docs/upgrading.md).

### Installing

- **One command installs the panel.** `sudo bash deploy/linux/install-panel.sh`
  checks the machine, generates the secrets, writes `deploy/panel/.env`,
  detects this machine's public address, writes `/etc/caddy/Caddyfile`, starts
  the containers, waits for the database and the panel to be healthy, makes the
  first owner, and checks that the finished https address answers. It asks two
  questions: whether you have a domain name, and who the owner is. **Nobody has
  to open `.env`, `docker-compose.yml` or the `Caddyfile` any more**, and the
  beginner documentation no longer tells anybody to run `chmod`.
- **Running it again is the upgrade and the repair.** It never regenerates a
  secret that is already there — `SECRETS_KEY` is what every stored node token
  is encrypted under — never removes a volume, a game server or a backup, and
  keeps a `Caddyfile` you have edited.
- **The panel decides about its own certificate authority, not you.** A panel
  reached at an address rather than a name signs its certificates with an
  authority only it has, and a node agent has to be given that authority. The
  Add a node dialog now reads its own `PANEL_URL`, sees an IPv4 or IPv6
  address, and writes `--panel-ca auto` into the Linux command itself. A panel
  with a domain name gets no such option, and neither does a panel on plain
  `http://` — there is no certificate to distrust. Nothing asks, and there is
  no setting for it: `needsPanelAuthority` in `web/src/lib/agent-command.ts` is
  the one place that decides.
- **`--panel-ca auto` now means "that authority, from this machine"**, and says
  what to do when it is not there. It used to be one fixed path, so a command
  carrying it on a node away from the panel failed on a file the reader had
  never typed. It looks where the panel's installer leaves the authority and
  where Caddy keeps it, and on a node somewhere else it names the one thing to
  do — copy `/etc/geeboard/panel-ca.crt` over and pass its path — rather than
  stopping on a path that was never going to exist there.
- **HTTPS without a domain name is arranged for you.** The installer detects
  the public address, offers it, writes `tls internal`, waits for Caddy to
  create its certificate authority, and copies it to
  `/etc/geeboard/panel-ca.crt` — where the node installer finds it **without
  being told**. `--panel-ca` is now only for a node that is not the panel's own
  machine. What a private authority is, and how it differs from a public
  certificate, is said on screen while it happens.
- **The installers repair permissions themselves.** A checkout copied from
  Windows, unpacked from a zip or restored from a backup arrives with no
  execute bit and sometimes with Windows line endings, which reads as "bad
  interpreter: no such file or directory". Both are fixed, to `0755` — never
  `777` — and a file that cannot be fixed is named with the one command for it.
  Every documented command now runs an installer through `bash`, which needs no
  execute bit at all.
- **A Windows node is one command too.**
  `deploy\windows\install-node.ps1` checks Node.js, npm and Docker Desktop,
  unblocks the scripts Windows marked as downloaded, installs the dependencies,
  joins the panel, registers the **Geeboard Agent** task and waits for the agent
  to answer. The panel's Add a node dialog writes that one line — with
  `-ExecutionPolicy Bypass`, because a fresh Windows install refuses every
  `.ps1` — instead of the four it used to hand over.
- **The Linux node installer says what it is doing**, repairs the same
  permissions, tells "the panel is not there" apart from "the panel is there and
  this machine does not trust its certificate" *before* it registers, and checks
  that the agent answers on this machine as well as whether the panel could
  reach it.
- `deploy/lib/` is new, and is where the installers keep what they share: the
  staged output, the checks, the permission repair and the reading and writing
  of the environment file. `deploy/panel/init.sh` uses it too, so there is one
  implementation of "never overwrite a secret" rather than two.
- **The documentation follows the installer.**
  [Install Geeboard](docs/production.md) is now what the panel is, what a node
  is, choosing a setup, the three commands, a Linux node, a Windows node, the
  first server, and troubleshooting. Everything as separate commands moved to
  [Advanced installation](docs/advanced-install.md), which is not deprecated —
  it is what the installer runs.

### Files

- **Upload from the panel.** The Files page has an upload button and takes a
  drop onto the listing: one file at a time, up to 256 MB each, with a
  progress bar while it goes. A name already in the folder asks before it is
  written over. The node still writes beside the target and renames, so an
  upload that drops halfway leaves the file that was there, and every upload
  is in the audit log with its size — none of that is new, only the button is.
- **Download from the panel.** Every file's row has an arrow. The bytes stream
  from the node through the panel; nothing is held in either.
- A folder cannot be uploaded. Make it in the panel and drop the files into
  it, which is what the game wants anyway.
- **The file list is readable on a phone again.** Four columns of metadata had
  squeezed the name column to nothing below 1024px, so a listing showed sizes,
  dates and modes of files whose names were not on the screen.

### Fixed

- **"Create it anyway, over the node's capacity" can be reached now.** It was
  offered on the review step and the create operation took it, but the same
  memory and CPU checks also disabled **Next** on the resources step before it
  — so the only route to the checkbox ran through a button the checkbox was
  needed to enable. Memory and CPU now stop the create on the review step,
  where the sentence that clears them is on the screen; storage still stops
  both, and nothing anywhere offers a way past it. The API has always accepted
  `"overcommit": true`, so this was the wizard alone.
- The same checkbox now appears on a node with **no agent** as well. Capacity is
  counted for those too, and the create refuses them the same way, so the card
  that said only "this one will be simulated" was the second dead end of the
  same shape.
- The rules about what stops each step moved to `web/src/lib/create-wizard.ts`,
  out of the component, with a test that walks every combination of shortfall
  and step and fails if the wizard can ever refuse something it is not also
  asking about.
- **The mark is on every screen now.** Three kept the placeholder they had
  before there was one — a lightning bolt in a lime square: the second step of
  signing in, the page a one-time link lands on, and the create wizard's own
  header, which runs outside the shell and carries its own. The favicon and the
  touch icon were always the mark, so only screens were wrong. A test now
  refuses both the shape of that placeholder and a wordmark with no mark beside
  it.

## [0.2.0] — 2026-09-22

### Mods

- **Project Zomboid servers take Steam Workshop mods**, from a new **Mods** tab
  on a server. Search the Workshop in the panel — with pictures, sizes and
  subscriber counts — or paste an item's link, arrange the load order, switch
  one off without losing its download, and **Apply to server** writes the list
  into the game's own settings. The game downloads them itself, on the node:
  the panel never holds or forwards a mod's files.
- **Browsing needs a Steam Web API key.** Set `STEAM_API_KEY` on the panel to
  search; without it the tab still adds any mod by its Workshop link or id,
  which needs no key at all.
- **Upgrade the nodes.** The agent answers a new question — what a server
  downloaded, and which mod ids are inside each download, read from the files
  themselves — and accepts a mount one directory deeper, which is where
  Zomboid's Workshop downloads live. A panel on this release with an agent from
  `0.1.x` refuses to place servers on it, as the release-line rule says it
  should: upgrade the agent on each node the way it was installed.
- A game that does not declare how it takes mods shows the tab greyed out
  rather than an empty catalogue. Minecraft plugins are still not implemented.

### The panel

- **A server can be created past a node's capacity, on purpose.** Memory and
  CPU limits are ceilings on what a server may take rather than reservations
  of what it does take, so the create wizard now offers a checkbox where the
  node is short — naming the totals it would be committed to and what happens
  past them — and the API takes `"overcommit": true`. Each one is written to
  the audit log as `server.overcommitted` against the name of whoever asked.
  **Storage is not included**: a full disk stops every world on the node
  mid-write, so that refusal stands. Moving a server onto a full node still
  refuses outright.
- **Games have covers.** The striped rectangle with an abbreviation in it is
  now a drawing per game — wherever the panel shows one, which is the
  dashboard, the servers list, a server's page, a node's page, the Games page
  and the create wizard. They are drawn in the panel itself: nothing is
  downloaded, nothing is stored, and the panel still works with the network
  gone. A game with no drawing keeps the striped square rather than showing a
  broken image.

### Installing

- **A panel with no domain name is a documented case now.** Caddy's `tls
  internal` signs a certificate for an address with an authority private to
  that machine, and a node agent — a Node.js program that trusts the public
  authorities — refused it. `deploy/linux/install.sh … --panel-ca auto` copies
  Caddy's root certificate to `/etc/geeboard/panel-ca.crt` and gives the agent
  it as `NODE_EXTRA_CA_CERTS`: one authority **added** to the ones it already
  trusts. `--panel-ca <file>` is the same for a node that is not the panel's
  machine. Nothing turns certificate checking off, and
  `NODE_TLS_REJECT_UNAUTHORIZED=0` remains unsupported.
- `deploy/panel/Caddyfile` holds both reverse-proxy blocks — a domain with a
  public certificate, and an address with `tls internal` — and
  [docs/production.md](docs/production.md) is a Docker-only installation guide
  from a fresh Ubuntu machine to a server created on a node. The units under
  `deploy/panel/systemd/` still work and are no longer documented as a second
  way to install.
- `install.sh`, `uninstall.sh`, `init.sh` and both container entrypoints are
  executable in git (`100755`): a fresh checkout no longer needs `chmod +x`.

### Nodes

- **The panel checks that it can reach a node, and says so.** Registering
  proved one direction only — the agent reaching the panel — so a machine
  whose port nothing could open still registered, heartbeated, and failed at
  the first server placed on it. The panel now calls the node's advertised
  address while answering a heartbeat, when it has not reached it in the last
  30 seconds, and tells the agent what happened; the agent prints
  `the panel cannot reach this node` with the address and the reason, and
  `install.sh` waits for that answer and prints it too.
- Node health decays from `lastReachedAt` — the panel reaching the node — and
  no longer from `lastSeenAt`, which a heartbeat refreshed every fifteen
  seconds. **A node the panel cannot reach now reads as `UNREACHABLE` within
  two minutes instead of as healthy**, which is what it always was. A
  heartbeat on its own no longer clears a fault; a call that gets through
  does, from either the watchdog or a heartbeat's own check. The node's page
  shows both timestamps, as *Last seen* and *Reached*, and the API's node
  shape carries `lastReachedAt`.
- The agent says why a request to the panel failed. "Registering with the
  panel failed: fetch failed" now names the cause — an untrusted certificate
  authority and the code under it, an expired certificate, a refused
  connection, a name that does not resolve, a timeout — without printing any
  token.

### The documentation site

- **The site at <https://danielemarino70.github.io/Geeboard/> is built by this
  repository now**, by `docs-src/build.mjs`, instead of by Jekyll and a theme
  fetched from somebody else's repository. **Every address still answers** —
  `reference.html` and its twenty siblings keep their names — and every page
  still reads on GitHub as Markdown.
- **Installing on a server is the first page of the documentation.** The home
  page's main link goes there rather than to an index, and the navigation says
  which of the three kinds of reading a page belongs to: set it up, run it day
  to day, know how it is built. No page was rewritten and no section moved to
  another page.
- **The site needs nothing from the network to be read.** The stylesheet and
  both fonts are served from the site itself.
- **Nothing in `docs/` changed for a reader on GitHub.** Links between pages
  are still relative and still end in `.md`.

### The mark

- **Geeboard has its logo on it.** The panel's sidebar and its sign-in page
  carried a lightning bolt from an icon set; the browser tab carried the
  Next.js starter's favicon. Both are the mark now, and so are the
  documentation site, its link previews and the README.
- **The tab icon changes.** `web/src/app/favicon.ico` is gone and
  `web/src/app/icon.svg` takes its place. A browser that cached the old one
  shows it until it refetches; nothing else changes for an installation.
- **`web/public/` lost five unused files** from the Next.js starter —
  `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`. Nothing
  referenced them.
- **The name and the mark are not covered by the AGPL grant.** The software
  stays AGPL-3.0-only and that does not change; what is new is
  [brand/LICENSE.txt](brand/LICENSE.txt), which says a fork may use the code
  and may not ship as Geeboard. Taking the mark off a fork is one directory
  and the list in [brand/README.md](brand/README.md).
- **Upload the social preview by hand.** GitHub has no file for it:
  *Settings → General → Social preview*, with `brand/og.png`.

### Node 24, and the dependencies with it

- **The images run Node 24.** Both `Dockerfile`s and the checks moved from 22,
  which leaves active support this October, to the line supported until April
  2028. Nothing about how you install or upgrade changes: the panel and the
  agent are containers, and the container carries its own Node.
- **A checkout needs Node 22 or newer**, and 24 is what everything here is
  built and tested with. Node 20 went end of life in April 2026 and the
  requirement in [docs/installation.md](docs/installation.md) said 20.
- **Next 16.3.5, React 19.3.0, lucide-react 1.47, tsx 4.23.15** and the
  matching type packages. Patch and minor releases only; nothing changes for
  an installation.

### If you run your own copy of the site

- **Set Pages to "GitHub Actions".** In *Settings → Pages*, the source has to
  change from *Deploy from a branch* to *GitHub Actions*, or
  `.github/workflows/docs.yml` will build and check the site and publish
  nothing. `docs/_config.yml` and the front matter at the top of each page are
  gone with this release, so a repository still set to *Deploy from a branch*
  serves the Markdown through Jekyll with no theme and no navigation.
- **Previewing the documentation is `cd docs-src && npm ci && node build.mjs`,
  then `node serve.mjs`** on <http://localhost:4000>, and no longer the
  `github-pages` gem in a Ruby container. See
  [docs/development.md](docs/development.md).

## [0.1.0] — 2026-09-21

The first release. Everything below is new because there was nothing before it
to change.

### Installing

- `npm run setup` makes the first owner: migrations with `prisma migrate
  deploy`, the game catalog, and one `OWNER` account with a temporary password
  printed once in the terminal, stored only as a hash and good for 24 hours.
  Signed in with it the account sees nothing until it has been replaced with a
  password of your own — and only then is two-factor asked for.
- `npm run admin:recover` is the way back in from a temporary password that was
  lost or ran out, a forgotten password, or a phone and its recovery codes both
  gone. It runs on the panel's own machine and has no web equivalent.
- The sample workspace (`npm run db:seed`) refuses to run with
  `NODE_ENV=production`, and the account it creates is no longer the only way
  to have one.
- The panel refuses to start on a configuration it cannot be trusted with:
  a missing `DATABASE_URL` or one still on the development password, a secret
  that is missing, short, identical to the other, or that looks like an
  example.
- **Docker:** one image with five verbs — `panel`, `poller`, `migrate`,
  `setup`, `recover` — and `deploy/panel/docker-compose.yml`, which publishes
  the database nowhere, has no default for any secret, and puts the panel on
  loopback for a reverse proxy. `deploy/panel/init.sh` generates the three
  secrets into a file it never overwrites.
- **Without Docker:** `deploy/panel/systemd/` runs the same thing from a
  checkout.
- [docs/production.md](docs/production.md) is the whole path, from `git clone`
  to signed in, with TLS.

### Nodes

- **Add a node** names a machine and hands you one command to run on it. The
  agent works out its own address, makes its own secret, registers under that
  name and saves its settings; you approve it in the panel when it appears.
- The agent installs as something that starts at boot: a container under
  systemd on Linux, a scheduled task on Windows.
- A node reports what its container engine can hand out, not what the machine
  has — under Docker Desktop that is the VM's share — so the panel stops
  placing servers the engine could never hold.
- Creation refuses a node that cannot run the game: wrong operating system or
  architecture, or a capability the node has not declared.
- An agent's token can be rotated from the node's page with the node in
  service, and nobody is shown the token.
- Retiring a node moves or deletes its servers, drains it and removes it, and
  refuses removal while anything on the machine would be lost track of.

### Game servers

- Five games run from their own images: Minecraft Java (Paper), Minecraft
  Bedrock, Terraria (vanilla and TShock), Valheim and Project Zomboid.
- Create, start, stop, restart, delete, with an audit trail, and a create that
  fails rolls back everything it did.
- A live console over WebSocket, with commands going to the game's stdin.
- A file manager confined to each server's own directory.
- Backups that copy bytes: archived and hashed on the node, restored only after
  the hash is checked. With an S3-compatible bucket configured on the Backups
  page they go off-site on a URL the panel signs, so a node never holds the
  keys and a dead node leaves its backups behind.
- Moving a server to another node, through the bucket, with a rollback at every
  step that leaves it running where it was.
- Scheduled backups, restarts, broadcasts and cleanups, run by the poller
  rather than by a page.
- Updates that back up first, stay inside a version's line and leave a recorded
  way back.
- Health checks that ask the game rather than the container, and crash recovery
  with a ceiling and growing delays so nothing restart-loops.

### The API

- An HTTP API at `/api/v1` that does what the panel's buttons do to servers,
  settings, files, backups, scheduled tasks and nodes, and reads the audit log.
  Every scope on the API keys page has routes behind it.
  See [docs/api.md](docs/api.md).

### Known limitations

Read [docs/limitations.md](docs/limitations.md) before planning around any of
this. The short version: three games are written but have never been run and
are not offered; plugins, mods and the Steam Workshop are not implemented; the
panel sends no email, so a password reset is a link an admin hands over; and
off-site backups have been proved against MinIO, not yet against a commercial
provider.

[Unreleased]: https://github.com/DanieleMarino70/Geeboard/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.8.1
[0.8.0]: https://github.com/DanieleMarino70/Geeboard/compare/v0.5.0...v0.8.1
[0.7.0]: https://github.com/DanieleMarino70/Geeboard/compare/v0.5.0...v0.8.1
[0.6.0]: https://github.com/DanieleMarino70/Geeboard/compare/v0.5.0...v0.8.1
[0.5.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.5.0
[0.4.1]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.4.1
[0.4.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.4.0
[0.3.5]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.5
[0.3.2]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.2
[0.3.1]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.1
[0.3.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.0
[0.2.4]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.4
[0.2.3]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.3
[0.2.2]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.2
[0.2.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.0
[0.1.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.1.0
