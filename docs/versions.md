---
title: Versions
parent: Operate
nav_order: 2
---

# Versions

## "Latest" means five different things

They are routinely not the same number, and collapsing them is how a panel ends
up offering an update it cannot install.

| | |
| --- | --- |
| **Game latest** | What the game itself is on |
| **Server latest** | The newest dedicated-server build that exists |
| **Supported latest** | The newest one Geeboard will actually install |
| **Installed** | What this server is running now |
| **Recommended** | What a new server should be given today |

A worked example — illustrative: Terraria's definition does install 1.4.5.8
today, and recommends it:

```
Terraria
  Game latest        1.4.5.8     Re-Logic shipped it to clients
  Server latest      1.4.5.8     the dedicated build followed
  Geeboard supports  1.4.4.9     no definition for it yet
  Installed          1.4.3.6
  Recommended        1.4.4.9
```

Two true statements at once: there is an update available, and it is not the
newest thing that exists. The panel says both. Do not assume the latest Steam
version is the latest downloadable dedicated server, and do not assume the
newest number is installable.

Resolution prefers a stable channel over a numerically newer preview: a beta
that sorts higher is still not what `supportedLatest` or `recommended` point at.

And the newest version is not necessarily an update. Project Zomboid's build 42
went stable with 42.20 in July 2026: it is the recommendation for a new server,
the newest thing there is, and **not** an update for a build 41 server, whose
world does not open in it. See [Lines](#lines--what-counts-as-an-update).

## Providers

```ts
interface IGameVersionProvider {
  readonly id: string;
  list(game: GameDefinition): Promise<VersionCandidate[]>;
  latestUpstream?(game): Promise<{ game?: string; server?: string } | null>;
}
```

`latestUpstream` is optional because most sources cannot tell the difference
between "the newest thing you can download" and "the newest thing that exists" —
and that difference is exactly what separates the first three rows above.

A definition names its sources, with the arguments each one needs:

```ts
versionSources: [{ provider: "static" }, { provider: "steam", appId: 380870 }],
versionSources: [{ provider: "github", owner: "someone", repo: "their-server", match: "^v\\d" }],
```

A union rather than a list of strings, so naming a provider without what it
needs is a compile error rather than a game whose versions never load. Naming
one that is not registered is **not** an error — it is skipped, so a definition
can describe where its versions will eventually come from.

### Registered today

| | |
| --- | --- |
| `static` | Everything a definition ships with. Always present, always first, cannot fail. |
| `steam` | Branches and build ids, via `api.steamcmd.net`. Anonymous. |
| `github` | Releases, filtered by an optional tag pattern. Unauthenticated: 60 requests an hour. |
| `minecraft-launcher` | Mojang's version manifest — the only source that can say what the *game* is on. |

Vanilla Terraria is deliberately static. Re-Logic publishes the dedicated server
as a zip with no machine-readable index, and HTML scraping is not a version
source. TShock does publish releases, and Terraria's definition named them as a
`github` source until the release work — behind a tag pattern, `"^v?\d"` in a
plain TypeScript string, which is `^v?d` and matched nothing. The source was
removed rather than the escape corrected. A TShock release is numbered as
TShock (5.2.4), not as Terraria (1.4.4.9), so in `upstream` it would have told
every Terraria server that the game was past what Geeboard installs; and what
runs is a pinned image tag, so a release is installable the day a version is
added to the definition and not before. The `github` provider stays, for a game
whose release tags are its versions; no shipped definition names it.

## Steam has no version numbers

It has **branches** — `public`, `legacy41` — and each branch has a **build id**,
an integer that increases whenever the depot changes.

A branch is a moving pointer, and what it points at can change completely. On
29 July 2026 Zomboid's `public` stopped carrying build 41 and started carrying
build 42. A version is pinned to a branch name, so the definition has to follow:
build 41 is now the version tracking `legacy41`, and a definition still saying
"build 41 is on public" attaches build 42's build id to a version labelled
build 41.

This is not a detail. Rust has no version string at all: Facepunch pushes a
build to `public` and every server is suddenly out of date, with nothing to
compare. The build id is the only signal there is.

It is also a trap. `17851234` compares above every version string any game has
ever had, so a build id reaching a version comparison would report every server
as permanently and wrongly behind. So:

- A build id never goes into `upstream`, and never into `serverLatest`
- It lives in its own field, alongside `branch` and `updatedAt`
- It is merged onto the version that declares the matching `steamBranch`
- The branch's own row is dropped once merged — a branch is a moving pointer,
  not something to install
- A branch nothing tracks stays listed, unsupported: worth knowing it exists,
  not worth putting on a server

`Server.installedBuildId` records what a server was installed from, and
`outlook.buildDrift` compares it against the branch's current build id. A server
with no recorded build id is **not** reported as out of date — not knowing is
different from being behind, and a server installed before build ids were
recorded must not nag forever.

## Resolution

`resolveVersions(game)` asks each named provider, merges, and returns a
`VersionCatalog`.

- **First provider to claim an id wins.** The static provider runs first, so a
  definition can always overrule what a remote source says about a version it
  has an opinion about.
- **A provider that fails is reported, never swallowed.** `providerErrors` is
  part of the result and is rendered by the API. A stale list is usable; a
  silently stale one is not.
- **The static provider cannot fail**, which is what guarantees a network
  provider having a bad day never empties the version list.

Ordering is newest first by upstream version, then by release date, then by id —
so versions that cannot be dated still land somewhere stable rather than
reshuffling between two renders.

## Comparing

Game versions are dotted and mostly numeric — `1.21.4`, `1.4.4.9`, `41.78.16` —
and none of them are semver. Minecraft changed scheme outright in 2026, to the
year and the drop: `26.2` follows `1.21.11`, and compares above it for the
ordinary reason that 26 is more than 1. `compareVersions` compares numeric segments as
numbers, so `1.10` beats `1.9`, falls back to a string comparison for anything
else, and treats a missing segment as older, so `1.21` precedes `1.21.4`.

## The outlook

`outlookFor(catalog, { versionId, buildId })` is the answer to "is there an
update?"

```ts
{ installed, installedLabel, gameLatest, serverLatest, supportedLatest,
  recommended, recommendedVersionId, updateTo, newerLine, updateAvailable,
  aheadOfSupport, branch, installedBuildId, currentBuildId, branchUpdatedAt,
  buildDrift }
```

`updateTo` is what an update would move this server to. `newerLine` is a newer
version it cannot be updated to, because it is in another line — said, because
the operator can read the patch notes, and never offered.

`aheadOfSupport` is the honest half: the game has moved on and Geeboard cannot
install the new version yet. Showing "up to date" to somebody who can read the
patch notes is how a panel loses an operator's trust.

The version panel's badge and its update button ask this through the same
`updateTargetFor()`, so they cannot disagree about whether there is an update.

## Lines — what counts as an update

A version may declare a `line`. Versions in one line are updates of each other;
moving between lines is not an update, whatever the numbers say.

```ts
{ id: "paper-1-20-6", line: "paper", … }     // updates to paper-1-21-4
{ id: "fabric-1-21-4", line: "fabric", … }   // never offered Paper
{ id: "b41", line: "b41", … }                // never offered build 42
```

An update target is **newer** by version string, **installable**, **in the same
line**, and **no less stable** than what the server is on — so a legacy server
is moved up to stable, and a production server is not moved onto a beta. Two
versions with no version string are not ordered at all: "cannot tell" is never
"newer", and the build id answers the update question for those.

This replaced "offer the recommended version to any server not already on it",
which proposed Paper to a Fabric server and — once Zomboid's definition was
corrected — would have proposed build 42 to every build 41 world.

`updateServerOp` enforces the same rules, before it takes a backup: a different
line and an older version are both refused, because the API accepts any version
id and a refusal that stops the server first has already done the damage.
Rolling back, not updating, is how a server goes back down.

## Renaming a version

A version id is stored on servers, in rollback records and in API callers'
scripts, so it names what the version *is*, never how it is distributed —
`b41-stable` stopped being true the day build 42 took the public branch.

When an id has to change anyway, the old one goes in `formerIds`:

```ts
{ id: "b41", formerIds: ["b41-stable"], steamBranch: "legacy41", … }
```

- `findVersion()` still finds it by the old id, so a rollback recorded against
  it still works
- The sync renames the stored row in place rather than creating a second one.
  Servers link to the row by its primary key, so every link comes across
  without touching a server. If both rows already exist, servers move to the
  new one and the old row is deleted
- A build id stored for a branch the version no longer tracks is cleared, even
  offline — it belongs to somebody else's branch

A version Geeboard stops installing stays in the definition with
`supported: false`. Zomboid's `b42-unstable` is kept that way: its branch is
gone, but the servers made on it still need to resolve to something that says
what they are. The wizard does not list it and creating a server on it is
refused.

A server's version is read from its catalog link first and its stored label
second, through `versionOfServer()`. When neither resolves, the answer is
"cannot say" — a settings rebuild used to fall back to the definition's first
version, which is a guess that would have rebuilt a build 41 world on build 42.

Available from the API at `GET /api/v1/servers/:id` and
`GET /api/v1/games/:id/versions`.

## The catalog tables, and why nothing else goes upstream

The catalog sync (`syncCatalog` in `lib/catalog-sync.ts`) resolves every game
and upserts `Game` and `GameVersion` rows. **It is the only thing in Geeboard
that asks upstream about versions**, and two things run it: the poller, whenever
the oldest synced game is more than six hours old (`CATALOG_SYNC_INTERVAL_MS`;
`0` turns it off), and `npm run games:sync`, by hand.

Everything else — the games page, the server page, the API — reads those rows
through `lib/catalog-read.ts`. Rendering a page must never depend on Steam being
up, on GitHub's unauthenticated rate limit, or on eight HTTP round trips
happening before a list of games can be drawn. A provider outage can make the
catalog stale; it cannot take a page down.

Both paths summarise through the same `summariseCatalog()`, so "the newest
supported version" cannot mean one thing when read live and another when read
from the database. A game with no rows falls back to its definition, so a panel
that has never been synced still works — with exactly the versions the
definitions ship, which is the honest answer.

```bash
npm run games:sync              # ask upstream, using the 30-minute cache
npm run games:sync -- --refresh # ask upstream, ignoring the cache
npm run games:sync -- --offline # definitions only, no network
```

Seeding runs the offline path: seeding happens on laptops, on planes and in CI.
The command exits non-zero if a provider failed, and the poller prints the same
failure as a warning and carries on; either way the rows it could not refresh
keep what they had — including build ids, which a pass that did not hear from
Steam must not overwrite with "none".

The poller starts a sync and does not wait for it, because servers must not go
unwatched while Steam is slow, and it reads the catalog's age from the rows
rather than from a timer of its own, so a restart does not resync and a sync
run by hand counts. Until September 2026 nothing scheduled it, and a panel left
alone offered last month's versions for as long as nobody ran the command.

Servers point at a `GameVersion`; a game that leaves the registry is marked
`retiredAt` rather than deleted, so nothing running loses its link. A *version*
that leaves a definition is not retired — its row stays, saying whatever it
last said, `supported` included — which is why a version Geeboard stops installing is kept in the
definition with `supported: false` instead of being removed.

Servers created before the catalog existed are linked up carefully: an exact
label match first, then by number *and* software — `"1.21.4 · Fabric"` was
written by hand before versions had ids. Both labels are reduced to what is left
once the number and the game's name are removed, and they must be the same:
`"1.21.4 · Fabric"` links to Fabric 1.21.4, and `"1.20.6 · Purpur"` links to
nothing, because the only 1.20.6 is Paper. Two matches link nothing either.

This used to take the first version whose number appeared in the label. Now that
the link decides which updates a server is offered, a wrong link is worse than
none. A server that does not match keeps working; it just has no catalog link,
and the labels on its own row are what the UI renders anyway.
