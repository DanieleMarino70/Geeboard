import "server-only";
import { asPlatformError } from "@/domain/errors";
import { followedVersions, tagOf, type TagRecord } from "@/domain/games/followed";
import { listTags } from "@/domain/games/providers/docker-tags";
import { allGames, followedVersionsHeld, setFollowedVersions, shippedDefinition } from "@/domain/games/registry";
import type { GameDefinition, GameVersion } from "@/domain/games/types";
import { db } from "./db";

/* The versions that are tags of a game's image, in this process.

   The registry holds them in memory (domain/games/registry.ts), as it holds the
   community games, and for the same reason this is a file of its own: the poller
   and the panel are two processes, and each has to be told. The poller asks the
   registry for its tags and writes what it found into the catalog; the panel only
   reads the catalog back, every few seconds, and so never waits on Docker Hub.

   A tag that has been a version is never forgotten. The catalog row of a followed
   version is kept with the servers that are on it, and a server whose version the
   panel cannot name cannot be run, shown or changed — so the versions read back
   from the rows are added to whatever the registry lists now. A tag that the
   registry has since deleted stays a version; the image is another matter, and a
   server on it is told so by the node when it pulls.

   The one way a followed version leaves is the definition catching up with it: a
   release of Geeboard that ships the version itself. That release gives the
   shipped version the followed id in `formerIds`, which is what the catalog sync
   moves the row (and the servers on it) by. */

/** What a set of followed versions is, as a string: the same set is the same string, in whatever order it was built. */
function describe(byGame: Record<string, GameVersion[]>): string {
  return JSON.stringify(
    Object.entries(byGame)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([game, versions]) => [game, versions.map((v) => `${v.id}=${v.image}=${v.recommended === true}`).sort()]),
  );
}

/** The games that follow their image's tags, as their definitions ship them. */
function followers(): GameDefinition[] {
  return allGames()
    .map((game) => shippedDefinition(game.id))
    .filter((game): game is GameDefinition => game?.followTags !== undefined);
}

/* The tags that already are versions of a game: the images of its REGISTRY rows in the catalog that are in the
   repository, dated by when the row says the version was released, and those this process holds now (a tag found a
   moment ago has no row until the next write of the catalog). */
async function knownTags(games: GameDefinition[]): Promise<Map<string, TagRecord[]>> {
  const rows = await db.gameVersion.findMany({
    where: { origin: "REGISTRY", gameId: { in: games.map((g) => g.id) } },
    select: { gameId: true, source: true, releasedAt: true },
  });
  const held = followedVersionsHeld();
  const out = new Map<string, TagRecord[]>();
  for (const game of games) {
    const repository = game.followTags!.repository;
    const images = [
      ...rows.filter((r) => r.gameId === game.id).map((r) => ({ image: r.source, pushedAt: r.releasedAt?.toISOString() ?? null })),
      ...(held[game.id] ?? []).map((v) => ({ image: v.image, pushedAt: v.released })),
    ];
    const tags: TagRecord[] = [];
    for (const { image, pushedAt } of images) {
      const name = tagOf(image, repository);
      if (name) tags.push({ name, pushedAt });
    }
    out.set(game.id, tags);
  }
  return out;
}

export interface FollowedReport {
  /** Whether what the registry holds is not what it held before. */
  changed: boolean;
  /** How many followed versions it holds now. */
  held: number;
  errors: Array<{ game: string; message: string }>;
}

/* Gives the registry the followed versions of every game: those of the tags `listed` (where the registry was asked and
   answered) and those the catalog already holds. */
async function hold(games: GameDefinition[], listed: Map<string, TagRecord[]>, errors: FollowedReport["errors"]): Promise<FollowedReport> {
  const known = await knownTags(games);
  const next: Record<string, GameVersion[]> = {};
  let held = 0;
  for (const game of games) {
    const byName = new Map<string, TagRecord>();
    // The catalog's first and the registry's second: the registry's date is the better one.
    for (const tag of [...(known.get(game.id) ?? []), ...(listed.get(game.id) ?? [])]) {
      byName.set(tag.name, tag.pushedAt === null ? (byName.get(tag.name) ?? tag) : tag);
    }
    const versions = followedVersions(game, [...byName.values()]);
    if (versions.length === 0) continue;
    next[game.id] = versions;
    held += versions.length;
  }

  // Against what the registry holds, not against what this module last gave it: anything may have replaced that since.
  const changed = describe(next) !== describe(followedVersionsHeld());
  if (changed) setFollowedVersions(next);
  return { changed, held, errors };
}

/** Reads the followed versions back from the catalog, without asking anybody. For the panel, and for a process that starts. */
export async function loadFollowedVersions(): Promise<FollowedReport> {
  const games = followers();
  return games.length === 0 ? { changed: false, held: 0, errors: [] } : hold(games, new Map(), []);
}

/* Asks Docker Hub for the tags of every game that follows its image's, and gives the registry what they add. A repository
   that did not answer is a message in the report and not a failure: the versions the catalog holds stay, and the next sync
   asks again. `refresh` skips the 30-minute answer the provider cache would give. */
export async function refreshFollowedVersions(options: { refresh?: boolean } = {}): Promise<FollowedReport> {
  const games = followers();
  if (games.length === 0) return { changed: false, held: 0, errors: [] };

  const errors: FollowedReport["errors"] = [];
  const listed = new Map<string, TagRecord[]>();
  for (const game of games) {
    try {
      listed.set(game.id, await listTags(game.followTags!.repository, { refresh: options.refresh }));
    } catch (error) {
      errors.push({ game: game.id, message: asPlatformError(error).message });
    }
  }
  return hold(games, listed, errors);
}
