# Where the project is, and where it goes

0.12.0 carries all the code that 1.0.0 will have, and 1.0.0 is a release with no code in it: the
day the promise below starts to hold. This page is what is left before that, what 1.0 says,
and what may come after it. What is already done, phase by phase and release by release, with
what each step cost, is [How it was built](history.md); what a fresh installation does today is
[What works today](what-works.md), and what it does not, [What does not work yet](limitations.md).

## Where it is going

**0.12.0, then 1.0.0.** 0.12.0 takes out the last things 0.11 kept for a panel rolled back to
0.10.1 (the clear copy of join passwords, and the old name of an API scope written beside the
new one), gives the games their posters, and is documented as it is. There is no release
candidate: 0.12.0 is the candidate. A bug that the field checks or the days of use below find is
fixed in a 0.12.x, before 1.0.0. 0.11.1 is the release a panel on 0.12.0 goes back to
([Upgrading](upgrading.md#to-0120-the-clear-copy-is-gone)).

1.0.0 itself changes the version, the texts that say "not yet 1.0", and nothing else. From it on,
[the promise](extending.md#the-promise) holds inside a major version: the HTTP API and the two
webhooks only grow ([What the API promises](api-frozen.md)), a release only adds to the
database and the one after it removes, and a panel and an agent work together when they speak
the same contract, which is 1.

## What 1.0.0 needs

Each of these is checked, not intended. 1.0.0 is cut when every one is ticked; the owner ticks
them, and decides at the cut what is not settled here.

- [ ] 0.12.0 published, with every CI job green on its cut commit, read job by job: a job that is
  allowed to fail (the `ubuntu-26.04` ones) leaves the run green when it is red.
- [ ] The last weekly *Full verification* run green.
- [ ] No promise left open in the documentation, of the kind "until the release after …": a
  search finds none.
- [ ] The tests that hold the documentation to the code green: `api-frozen`, `api-docs`,
  `extending-docs` and `release-consistency`.
- [ ] deb upgraded from 0.11.1 to 0.12.0 from the Updates page, and a rollback to the 0.11.1
  image rehearsed once: the panel answers and a server starts.
- [x] A real player on a game other than Minecraft: the owner reports players joining and
  playing on Garry's Mod and Project Zomboid on deb, on 12 October 2026
  ([what was seen](release-matrix.md#seen-since-095-on-deb-in-use)).
- [ ] IPv6 from another network ([the check](field-checks.md#ipv6-from-a-network-that-has-it)).
- [ ] A pass with a screen reader, NVDA ([the check](field-checks.md#a-screen-reader)).
- [ ] Three days of ordinary use on deb with no restart that nobody can explain, and one restore
  of the nightly dump on another machine.
- [ ] The posters: with the network unreachable, the Games page draws them from the database or
  draws the cover; with `GEEBOARD_COVERS=off`, no request leaves the panel (`verify:covers`).
- [ ] `verify:a11y` green at 1280, 768, 375 and 320 pixels, in both themes.
- [ ] No Dependabot pull request open, or each one put off with a reason.
- [ ] The community games repository's pin green on 0.12.0, and then on 1.0.0.

The three field checks are written up in [field-checks.md](field-checks.md) and, once done, in
[release-matrix.md](release-matrix.md). Wanted and not blocking: a person following the README
from nothing with no help; a Windows node *reached* by a panel over a real network (a VPN between
deb and a Windows PC); M06, a fresh Windows with no Node.js and no Docker, in a Hyper-V machine
with nested virtualisation; Amazon S3 or Cloudflare R2 with a real bucket; the official Minecraft
client through an SRV record ([what was not done](release-matrix.md#what-was-not-done)).

## Phase 6 — Extensibility, and what 1.0 says

Version 1.0 is declared when this is true, and not before:

> **Adding a game that runs from an image, is configured through environment variables,
> files in the formats Geeboard writes or command-line flags, and is judged by its log, a
> port, a query or a process, is a definition file and a registry line. Adding a node
> needs no change to the panel. Adding a DNS provider is one table entry and one client;
> any other is a webhook and needs none. Adding an S3-compatible storage is one preset.
> None of them changes the architecture.**

[Extending Geeboard](extending.md) is that sentence's proof: a recipe for each of the eleven things
people add, what stops you if you forget a step, what nothing stops you from forgetting, and a test
that fails when the page and the code part. What the sentence leaves out — a store that is not
S3-compatible, a game whose console is only RCON, a setting format the panel cannot write, an
install that is not an image, mods from anywhere but the Steam Workshop, a runtime other than Docker,
an architecture other than x64 — is written there as the edge of the promise, because each of them is
shared code, not data. Workshop mods are inside it since 0.10.0, when a second game took them through the
same tab and the same code, and the shapes it needed became values any definition may declare: a game
that takes its mods from the Workshop in one of the ways its `mods` declaration can express is a
definition file like any other. From 1.0 on the API and the two webhooks only grow inside a major version, and a release
only adds to the database (the same page, "The promise").

- Mods from the Steam Workshop, declared in a game's definition (`mods`): Project Zomboid's were the
  first, written for it; Garry's Mod's (0.10.0) were the second, and added the shapes a list and a
  download can take rather than a `WorkshopProvider` of their own. What a third game can declare, and
  what would need code, is in [Extending Geeboard](extending.md#add-workshop-mods-to-a-game)
- More games, more version providers: [Extending Geeboard](extending.md)

## After 1.0

Each of these adds to what is there and changes none of it, so the promise allows it in any minor
release after 1.0. None is promised or dated; where today's limit is written down, the line says
where.

- **RCON**, as something an agent announces among its `features`, with the contract still 1. Until
  then a game whose console is only RCON is outside the 1.0 sentence above
  ([extending.md](extending.md#the-10-sentence))
- **Rust, Palworld and Satisfactory**, parked: each is a definition file already, and none is
  offered before it has run on a node with 24 GB or more ([the check](field-checks.md#rust-palworld-and-satisfactory))
- **A grant on one server** between member and moderator ([limitations](limitations.md#accounts-and-the-api))
- **The author of a scheduled task**, so that a task no longer runs with an admin's rights
  whoever wrote it ([limitations](limitations.md#found-by-the-audit-of-095-and-left))
- **The API routes that are not there yet**: rebuild, templates, clone, registration tokens, a node's
  details, a DNS retry, notification channels ([api.md](api.md#not-yet))
- **A Content-Security-Policy with a nonce** for scripts ([security.md](security.md#headers-and-cookie-authenticated-requests))
- **Tables that are tables**, where the pages draw rows as CSS grids ([limitations](limitations.md#accessibility))
- **arm64 images** ([what was not done](release-matrix.md#m21-arm64))
- **A community manifest that declares a poster** ([games.md](games.md#covers))
- **A node enrolled over SSH**, and **an installer for a panel on Windows**
- **E-mail**, for a new account, a reset or a notification ([limitations](limitations.md#notifications-templates-and-clones))

## Rules that hold across all of it

- The project stays runnable after every step
- Nothing is removed silently
- Docker stays an implementation detail
- A new game is a definition, not a change to the platform
- Complexity has to earn its place: no Kubernetes, no brokers, no cloud
  provisioning. The one thing done at a provider is a DNS record (0.4.0),
  opt-in, from the panel, with a token that can do that and nothing else

## How it was built

Until 0.12.0 the rest of this page was the story of the project, and it is now a page of its own,
[How it was built](history.md), as it was written. Each heading that was here still answers at its
old address and leads there.

**Before the first release**

- <a id="what-was-here-before-phase-1"></a>[What was here before Phase 1](history.md#what-was-here-before-phase-1)
- <a id="phase-1--foundation-"></a>[Phase 1 — Foundation](history.md#phase-1--foundation-)
- <a id="phase-2--game-system-"></a>[Phase 2 — Game system](history.md#phase-2--game-system-)
- <a id="phase-3--node-platform-"></a>[Phase 3 — Node platform](history.md#phase-3--node-platform-)
- <a id="phase-4--server-management-"></a>[Phase 4 — Server management](history.md#phase-4--server-management-)
- <a id="phase-5--operations-"></a>[Phase 5 — Operations](history.md#phase-5--operations-)
- <a id="interlude--a-real-machine"></a>[Interlude — a real machine](history.md#interlude--a-real-machine)
- <a id="phase-5b--the-panel-says-only-what-it-knows-"></a>[Phase 5b — The panel says only what it knows](history.md#phase-5b--the-panel-says-only-what-it-knows-)
- <a id="phase-5c--valheim-for-real-"></a>[Phase 5c — Valheim, for real](history.md#phase-5c--valheim-for-real-)
- <a id="phase-5d--project-zomboid-for-real-"></a>[Phase 5d — Project Zomboid, for real](history.md#phase-5d--project-zomboid-for-real-)
- <a id="phase-5e--minecraft-bedrock-for-real-"></a>[Phase 5e — Minecraft Bedrock, for real](history.md#phase-5e--minecraft-bedrock-for-real-)
- <a id="phase-5f--parking-the-games-that-never-ran-"></a>[Phase 5f — Parking the games that never ran](history.md#phase-5f--parking-the-games-that-never-ran-)
- <a id="phase-5g--zomboids-world-rules-written-by-the-panel-"></a>[Phase 5g — Zomboid's world rules, written by the panel](history.md#phase-5g--zomboids-world-rules-written-by-the-panel-)
- <a id="phase-5h--players-on-valheim-and-zomboid-declared-and-unverified"></a>[Phase 5h — Players on Valheim and Zomboid, declared and unverified](history.md#phase-5h--players-on-valheim-and-zomboid-declared-and-unverified)
- <a id="phase-5i--accounts-from-the-panel-"></a>[Phase 5i — Accounts from the panel](history.md#phase-5i--accounts-from-the-panel-)
- <a id="phase-5j--off-site-backups-"></a>[Phase 5j — Off-site backups](history.md#phase-5j--off-site-backups-)
- <a id="phase-5k--moving-a-server-between-nodes-"></a>[Phase 5k — Moving a server between nodes](history.md#phase-5k--moving-a-server-between-nodes-)
- <a id="phase-5l--the-agent-as-a-service-"></a>[Phase 5l — The agent as a service](history.md#phase-5l--the-agent-as-a-service-)
- <a id="phase-5m--the-api-does-what-the-panel-does-"></a>[Phase 5m — The API does what the panel does](history.md#phase-5m--the-api-does-what-the-panel-does-)
- <a id="phase-5n--what-was-left-before-a-release-"></a>[Phase 5n — What was left before a release](history.md#phase-5n--what-was-left-before-a-release-)
- [Phase 6 — Extensibility, and what 1.0 says](#phase-6--extensibility-and-what-10-says), still on this page
- <a id="phase-7--ready-to-install--for-the-first-release"></a>[Phase 7 — Ready to install (for the first release)](history.md#phase-7--ready-to-install--for-the-first-release)
- <a id="phase-8--a-release-somebody-else-can-install-"></a>[Phase 8 — A release somebody else can install](history.md#phase-8--a-release-somebody-else-can-install-)

**<a id="after-010"></a>[After 0.1.0](history.md#after-010)**

- <a id="the-games-have-covers-"></a>[The games have covers](history.md#the-games-have-covers-)
- <a id="phase-6-opens-mods-and-project-zomboid-takes-them-"></a>[Phase 6 opens: mods, and Project Zomboid takes them](history.md#phase-6-opens-mods-and-project-zomboid-takes-them-)
- <a id="the-documentation-site-is-built-here-now"></a>[The documentation site is built here now](history.md#the-documentation-site-is-built-here-now)
- <a id="the-mark-exists-as-a-file"></a>[The mark exists as a file](history.md#the-mark-exists-as-a-file)
- <a id="the-name-and-the-mark-are-reserved"></a>[The name and the mark are reserved](history.md#the-name-and-the-mark-are-reserved)
- <a id="the-panel-installs-in-one-command-022"></a>[The panel installs in one command (0.2.2)](history.md#the-panel-installs-in-one-command-022)
- <a id="an-address-has-to-be-an-address-023"></a>[An address has to be an address (0.2.3)](history.md#an-address-has-to-be-an-address-023)
- <a id="a-games-minimum-is-advice-and-a-collection-can-be-pasted-024"></a>[A game's minimum is advice, and a collection can be pasted (0.2.4)](history.md#a-games-minimum-is-advice-and-a-collection-can-be-pasted-024)
- <a id="mods-load-on-build-42-030"></a>[Mods load on Build 42 (0.3.0)](history.md#mods-load-on-build-42-030)
- <a id="the-panels-fonts-are-in-the-repository"></a>[The panel's fonts are in the repository](history.md#the-panels-fonts-are-in-the-repository)
- <a id="the-first-create-of-a-large-image-works-030"></a>[The first create of a large image works (0.3.0)](history.md#the-first-create-of-a-large-image-works-030)
- <a id="the-audit-log-keeps-a-deleted-servers-history-030"></a>[The audit log keeps a deleted server's history (0.3.0)](history.md#the-audit-log-keeps-a-deleted-servers-history-030)
- <a id="the-mods-edges-collections-out-an-api-and-what-an-item-needs-030"></a>[The mods' edges: collections out, an API, and what an item needs (0.3.0)](history.md#the-mods-edges-collections-out-an-api-and-what-an-item-needs-030)
- <a id="a-world-of-your-own-and-a-console-that-says-what-happened-031"></a>[A world of your own, and a console that says what happened (0.3.1)](history.md#a-world-of-your-own-and-a-console-that-says-what-happened-031)
- <a id="what-a-member-reads-of-somebody-elses-server-032"></a>[What a member reads of somebody else's server (0.3.2)](history.md#what-a-member-reads-of-somebody-elses-server-032)
- <a id="a-shell-on-the-node-and-a-node-that-arrives-by-itself-035"></a>[A shell on the node, and a node that arrives by itself (0.3.5)](history.md#a-shell-on-the-node-and-a-node-that-arrives-by-itself-035)
- <a id="a-member-who-owns-something-and-records-written-for-you-040"></a>[A member who owns something, and records written for you (0.4.0)](history.md#a-member-who-owns-something-and-records-written-for-you-040)
- <a id="closed-gaps-a-contract-and-a-key-that-can-change-041"></a>[Closed gaps, a contract, and a key that can change (0.4.1)](history.md#closed-gaps-a-contract-and-a-key-that-can-change-041)
- <a id="notifications-templates-of-your-own-and-clone-050"></a>[Notifications, templates of your own, and clone (0.5.0)](history.md#notifications-templates-of-your-own-and-clone-050)
- <a id="community-games-060"></a>[Community games (0.6.0)](history.md#community-games-060)
- <a id="a-servers-address-and-a-month-of-history-070"></a>[A server's address, and a month of history (0.7.0)](history.md#a-servers-address-and-a-month-of-history-070)
- <a id="a-dns-webhook-and-s3-proved-080"></a>[A DNS webhook, and S3 proved (0.8.0)](history.md#a-dns-webhook-and-s3-proved-080)
- <a id="nothing-is-trusted-because-it-is-written-090"></a>[Nothing is trusted because it is written (0.9.0)](history.md#nothing-is-trusted-because-it-is-written-090)
- <a id="audited-and-says-when-to-be-replaced-095"></a>[Audited, and says when to be replaced (0.9.5)](history.md#audited-and-says-when-to-be-replaced-095)
- <a id="a-games-new-release-without-one-of-ours-096"></a>[A game's new release without one of ours (0.9.6)](history.md#a-games-new-release-without-one-of-ours-096)
- <a id="community-games-from-the-panel-and-the-mods-tab-browses-like-the-workshop-097"></a>[Community games from the panel, and the Mods tab browses like the Workshop (0.9.7)](history.md#community-games-from-the-panel-and-the-mods-tab-browses-like-the-workshop-097)
- <a id="the-updates-page-upgrades-the-panel-098-never-published"></a>[The Updates page upgrades the panel (0.9.8, never published)](history.md#the-updates-page-upgrades-the-panel-098-never-published)
- <a id="098-published-099"></a>[0.9.8, published (0.9.9)](history.md#098-published-099)
- <a id="garrys-mod-and-its-addons-from-the-mods-tab-0100"></a>[Garry's Mod, and its addons from the Mods tab (0.10.0)](history.md#garrys-mod-and-its-addons-from-the-mods-tab-0100)
- <a id="what-a-real-machine-and-an-audit-found-0101"></a>[What a real machine and an audit found (0.10.1)](history.md#what-a-real-machine-and-an-audit-found-0101)
- <a id="the-last-window-for-breaking-things-0110"></a>[The last window for breaking things (0.11.0)](history.md#the-last-window-for-breaking-things-0110)
