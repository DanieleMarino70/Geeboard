import "server-only";
import type { VersionChannel as DbChannel, VersionSource } from "@prisma/client";
import { allGames } from "@/domain/games/registry";
import type { VersionChannel } from "@/domain/games/types";
import { resolveVersions } from "@/domain/games/versions";
import { db } from "./db";

/* Writing the catalog into the database.

   The game definitions are the source of truth; these rows are a
   projection of them. Having both is not duplication — a definition is
   code, and a server that has been running for six months needs to point
   at something that will still be there after the definition it was
   created from is edited or deleted.

   So this is an upsert, never a replace. A game that has left the
   registry is marked retired rather than deleted, because deleting it
   would take its versions with it and null out every server's link to
   what it is actually running. */

const CHANNELS: Record<VersionChannel, DbChannel> = {
  stable: "STABLE",
  snapshot: "SNAPSHOT",
  preview: "PREVIEW",
  legacy: "LEGACY",
};

const ORIGINS: Record<string, VersionSource> = {
  static: "STATIC",
  steam: "STEAM",
  github: "GITHUB",
  "minecraft-launcher": "OFFICIAL",
  "terraria-official": "OFFICIAL",
  registry: "REGISTRY",
  manual: "MANUAL",
};

export interface SyncReport {
  games: number;
  versions: number;
  retired: string[];
  linked: number;
  providerErrors: Array<{ game: string; provider: string; message: string }>;
}

export async function syncCatalog(): Promise<SyncReport> {
  const report: SyncReport = { games: 0, versions: 0, retired: [], linked: 0, providerErrors: [] };
  const definitions = allGames();
  const now = new Date();

  for (const game of definitions) {
    const fields = {
      name: game.name,
      family: game.family,
      art: game.art,
      blurb: game.blurb,
      official: game.official,
      popularity: game.popularity,
      portBase: game.portBase,
      portSpan: game.portSpan,
      requires: game.requirements.capabilities,
      memoryGbMin: game.requirements.memoryGbMin,
      diskGbMin: game.requirements.diskGbMin,
      retiredAt: null,
      syncedAt: now,
    };

    await db.game.upsert({
      where: { id: game.id },
      create: { id: game.id, ...fields },
      update: fields,
    });
    report.games++;

    /* Resolved rather than read straight off the definition, so that
       when the Steam and GitHub providers land in Phase 2 this file does
       not change: whatever they contribute is already in the catalog. */
    const catalog = await resolveVersions(game);
    for (const error of catalog.providerErrors) {
      report.providerErrors.push({ game: game.id, ...error });
    }

    for (const candidate of catalog.candidates) {
      const version = {
        label: candidate.label,
        upstream: candidate.upstream ?? null,
        // Where the runtime gets what it runs. An image reference today.
        source: candidate.image ?? candidate.download?.url ?? "",
        note: candidate.note ?? "",
        channel: CHANNELS[candidate.channel],
        origin: ORIGINS[candidate.providerId] ?? "MANUAL",
        supported: candidate.supported,
        recommended: candidate.id === catalog.recommended?.id,
        releasedAt: parseReleased(candidate.released),
        checksum: candidate.download?.sha256 ?? null,
        syncedAt: now,
      };

      await db.gameVersion.upsert({
        where: { gameId_slug: { gameId: game.id, slug: candidate.id } },
        create: { gameId: game.id, slug: candidate.id, ...version },
        update: version,
      });
      report.versions++;
    }
  }

  /* Anything left. Retiring is deliberately not deleting: servers still
     point at these rows, and the point of the catalog is that they can
     keep doing so. */
  const known = definitions.map((g) => g.id);
  const gone = await db.game.updateMany({
    where: { id: { notIn: known }, retiredAt: null },
    data: { retiredAt: now },
  });
  if (gone.count > 0) {
    const rows = await db.game.findMany({
      where: { id: { notIn: known } },
      select: { id: true },
    });
    report.retired = rows.map((r) => r.id);
  }

  report.linked = await linkExistingServers();
  return report;
}

/* Servers created before the catalog existed carry a family and a
   version label and nothing else. Matching them up is best-effort by
   design: a server whose label no longer resolves keeps working, it just
   has no catalog link, and the labels on its row are what the UI reads
   anyway. */
async function linkExistingServers(): Promise<number> {
  const servers = await db.server.findMany({
    where: { gameId: null },
    select: { id: true, game: true, version: true },
  });
  if (servers.length === 0) return 0;

  const versions = await db.gameVersion.findMany({
    include: { game: { select: { id: true, family: true } } },
  });

  let linked = 0;
  for (const server of servers) {
    const inFamily = versions.filter((v) => v.game.family === server.game);
    if (inFamily.length === 0) continue;

    /* An exact label first, then anything whose upstream number appears
       in the stored label — "1.21.4 · Paper" was written by hand before
       versions had ids, so it will not match exactly. */
    const match =
      inFamily.find((v) => v.label === server.version) ??
      inFamily.find((v) => v.upstream && server.version.includes(v.upstream));
    if (!match) continue;

    await db.server.update({
      where: { id: server.id },
      data: { gameId: match.game.id, gameVersionId: match.id },
    });
    linked++;
  }
  return linked;
}

function parseReleased(released: string | undefined): Date | null {
  if (!released) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(released) ? `${released}T00:00:00Z` : released);
  return Number.isNaN(date.getTime()) ? null : date;
}
