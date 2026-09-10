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

A definition names the providers that may speak for it:

```ts
versionProviders: ["static", "steam"],
```

Naming one that is not registered is **not an error** — it is skipped. A
definition saying where its versions will eventually come from is more useful
than one that does not, and Phase 2 registering `steam` should not require
editing eight definitions.

### Registered today

| | |
| --- | --- |
| `static` | Everything a definition ships with. Always present, always first, cannot fail. |

### Planned

`steam` (app id → build id, branches), `github` (releases), `minecraft-launcher`
(the version manifest), `terraria-official`, `registry` (image tags), `manual`.

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

`outlookFor(catalog, installedVersionId)` is the answer to "is there an update?"

```ts
{ installed, installedLabel, gameLatest, serverLatest, supportedLatest,
  recommended, recommendedVersionId, updateAvailable, aheadOfSupport }
```

`aheadOfSupport` is the honest half: the game has moved on and Geeboard cannot
install the new version yet. Showing "up to date" to somebody who can read the
patch notes is how a panel loses an operator's trust.

Available from the API at `GET /api/v1/servers/:id` and
`GET /api/v1/games/:id/versions`.

## The catalog tables

`npm run games:sync` resolves every game and upserts `Game` and `GameVersion`
rows. Servers point at a `GameVersion`; a game that leaves the registry is
marked `retiredAt` rather than deleted, so nothing running loses its link.

Servers created before the catalog existed are linked up best-effort: an exact
label match first, then a version whose upstream number appears in the stored
label — `"1.21.4 · Paper"` was written by hand before versions had ids. A server
that does not match keeps working; it just has no catalog link, and the labels
on its own row are what the UI renders anyway.
