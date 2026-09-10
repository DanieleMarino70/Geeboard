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

A worked example:

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

`Build 42 unstable` for Project Zomboid is numerically ahead of `Build 41
stable`, and almost nobody should be running it. Resolution prefers a stable
channel over a numerically newer preview, so `supportedLatest` and
`recommended` both point at build 41 while build 42 stays in the list for
anybody who asks for it.

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
versionSources: [{ provider: "github", owner: "Pryaxis", repo: "TShock" }],
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
source. TShock publishes releases, so that half is live.

## Steam has no version numbers

It has **branches** — `public`, `unstable` — and each branch has a **build id**,
an integer that increases whenever the depot changes.

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
and none of them are semver. `compareVersions` compares numeric segments as
numbers, so `1.10` beats `1.9`, falls back to a string comparison for anything
else, and treats a missing segment as older, so `1.21` precedes `1.21.4`.

## The outlook

`outlookFor(catalog, { versionId, buildId })` is the answer to "is there an
update?"

```ts
{ installed, installedLabel, gameLatest, serverLatest, supportedLatest,
  recommended, recommendedVersionId, updateAvailable, aheadOfSupport,
  branch, installedBuildId, currentBuildId, branchUpdatedAt, buildDrift }
```

`aheadOfSupport` is the honest half: the game has moved on and Geeboard cannot
install the new version yet. Showing "up to date" to somebody who can read the
patch notes is how a panel loses an operator's trust.

Available from the API at `GET /api/v1/servers/:id` and
`GET /api/v1/games/:id/versions`.

## The catalog tables, and why nothing else goes upstream

`npm run games:sync` resolves every game and upserts `Game` and `GameVersion`
rows. **It is the only thing in Geeboard that asks upstream about versions.**

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
The sync exits non-zero if a provider failed, so a scheduled run can be noticed;
the rows it could not refresh keep what they had.

Servers point at a `GameVersion`; a game that leaves the registry is marked
`retiredAt` rather than deleted, so nothing running loses its link.

Servers created before the catalog existed are linked up best-effort: an exact
label match first, then a version whose upstream number appears in the stored
label — `"1.21.4 · Paper"` was written by hand before versions had ids. A server
that does not match keeps working; it just has no catalog link, and the labels
on its own row are what the UI renders anyway.
