import "server-only";
import type { GameVersion as VersionRow, VersionChannel as DbChannel } from "@prisma/client";
import { allGames, findGame } from "@/domain/games/registry";
import type { VersionChannel } from "@/domain/games/types";
import {
  resolveVersions,
  summariseCatalog,
  type VersionCandidate,
  type VersionCatalog,
} from "@/domain/games/versions";
import { db } from "./db";

/* Reading the catalog back out.

   The resolver in the domain layer asks upstream. This does not — it
   reads the rows the sync wrote, and that separation is the point.

   Rendering a page must never depend on Steam being up, on GitHub's
   unauthenticated rate limit, or on eight HTTP round trips happening
   before a list of games can be drawn. The sync is the one place that
   goes out to the network, on a schedule somebody chose; everything
   else reads what it left behind.

   A game with no rows yet falls back to its definition, so a panel that
   has never been synced still works — with exactly the versions the
   definitions ship, which is the honest answer. */

const CHANNELS: Record<DbChannel, VersionChannel> = {
  STABLE: "stable",
  SNAPSHOT: "snapshot",
  PREVIEW: "preview",
  LEGACY: "legacy",
};

const ORIGINS: Record<string, string> = {
  STATIC: "static",
  STEAM: "steam",
  GITHUB: "github",
  OFFICIAL: "official",
  REGISTRY: "registry",
  MANUAL: "manual",
};

function toCandidate(row: VersionRow): VersionCandidate {
  return {
    id: row.slug,
    label: row.label,
    upstream: row.upstream ?? undefined,
    image: row.source || undefined,
    note: row.note || undefined,
    released: row.releasedAt?.toISOString().slice(0, 10),
    channel: CHANNELS[row.channel],
    recommended: row.recommended,
    supported: row.supported,
    branch: row.branch ?? undefined,
    buildId: row.buildId ?? undefined,
    updatedAt: row.branchUpdatedAt?.toISOString() ?? null,
    providerId: ORIGINS[row.origin] ?? "manual",
  };
}

/* The summary is recomputed from the rows rather than stored, by the
   same function the live resolver uses. Storing it would go stale the
   moment a row was added, and a second implementation would eventually
   disagree with the first — which would show up as a panel that
   recommends one version and installs another. */

/** The stored catalog for one game, or its definition if nothing is stored. */
export async function storedCatalog(gameId: string): Promise<VersionCatalog | null> {
  const rows = await db.gameVersion.findMany({
    where: { gameId },
    orderBy: [{ recommended: "desc" }, { releasedAt: "desc" }, { label: "asc" }],
  });

  if (rows.length > 0) return summariseCatalog(gameId, rows.map(toCandidate));

  /* Never synced. Falling back to the definition keeps the panel usable
     on a fresh install; it just cannot know anything upstream has done. */
  const game = findGame(gameId);
  return game ? resolveVersions(game) : null;
}

/** The stored catalog for every game, in one query rather than one each. */
export async function storedCatalogs(): Promise<Map<string, VersionCatalog>> {
  const rows = await db.gameVersion.findMany({
    orderBy: [{ recommended: "desc" }, { releasedAt: "desc" }, { label: "asc" }],
  });

  const byGame = new Map<string, VersionCandidate[]>();
  for (const row of rows) {
    const list = byGame.get(row.gameId) ?? [];
    list.push(toCandidate(row));
    byGame.set(row.gameId, list);
  }

  const out = new Map<string, VersionCatalog>();
  for (const [gameId, candidates] of byGame) out.set(gameId, summariseCatalog(gameId, candidates));

  // Games with no rows fall back to their definitions, as above. Only
  // the static provider is registered here, so this touches no network.
  for (const game of allGames()) {
    if (!out.has(game.id)) out.set(game.id, await resolveVersions(game));
  }
  return out;
}
