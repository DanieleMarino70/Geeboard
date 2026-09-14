import "server-only";
import type { VersionChannel as DbChannel, VersionSource } from "@prisma/client";
import { registerBuiltInProviders } from "@/domain/games/providers";
import { allGames } from "@/domain/games/registry";
import type { GameDefinition, VersionChannel } from "@/domain/games/types";
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
  /** Version rows moved to a new id — see GameVersion.formerIds. */
  renamed: number;
  retired: string[];
  linked: number;
  providerErrors: Array<{ game: string; provider: string; message: string }>;
}

export interface SyncOptions {
  /* Ask upstream rather than reusing anything cached. The default for a
     sync — it is the one place that is *supposed* to hit the network,
     which is exactly why no page render does. */
  refresh?: boolean;
  /* Skip the network entirely and write only what the definitions ship.
     For a seed, a test, or a machine with no route out. */
  offline?: boolean;
}

export async function syncCatalog(options: SyncOptions = {}): Promise<SyncReport> {
  const report: SyncReport = {
    games: 0,
    versions: 0,
    renamed: 0,
    retired: [],
    linked: 0,
    providerErrors: [],
  };
  const definitions = allGames();
  const now = new Date();

  /* Without this, only the static provider is registered and the sync
     writes exactly what the definitions ship — which is the offline
     behaviour, and a legitimate one. */
  if (!options.offline) registerBuiltInProviders();

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
    const catalog = await resolveVersions(game, { refresh: options.refresh });
    for (const error of catalog.providerErrors) {
      report.providerErrors.push({ game: game.id, ...error });
    }

    report.renamed += await renameVersions(game);

    /* A provider that failed this pass contributed nothing, and "Steam
       did not answer" must not be written down as "this version tracks no
       branch". The build ids already stored are the best there is; they
       are kept until a pass that actually heard from upstream. */
    const heardFromUpstream = !options.offline && catalog.providerErrors.length === 0;

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
      /* The branch and its build id, for a game distributed through
         Steam. Kept out of `upstream` on purpose — see
         domain/games/versions.ts on why a build id is not a version. */
      const branch = {
        branch: candidate.branch ?? null,
        buildId: candidate.buildId ?? null,
        branchUpdatedAt: candidate.updatedAt ? new Date(candidate.updatedAt) : null,
      };

      await db.gameVersion.upsert({
        where: { gameId_slug: { gameId: game.id, slug: candidate.id } },
        create: { gameId: game.id, slug: candidate.id, ...version, ...branch },
        update: candidate.buildId || heardFromUpstream ? { ...version, ...branch } : version,
      });

      /* Kept only while it still belongs to this version. A build id
         stored for the branch a version used to track — Zomboid's build 41
         row holding public's id — says nothing about the branch it tracks
         now, and would read as drift against it. */
      if (!candidate.buildId && !heardFromUpstream) {
        const declared = game.versions.find((v) => v.id === candidate.id)?.steamBranch;
        await db.gameVersion.updateMany({
          where: {
            gameId: game.id,
            slug: candidate.id,
            branch: declared ? { not: declared } : { not: null },
          },
          data: { branch: null, buildId: null, branchUpdatedAt: null },
        });
      }
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

/* Moves the row of a version whose id has changed, before the upsert
   would otherwise create a second one under the new id.

   Moving rather than recreating is the whole point: a server links to
   the row by its primary key, so renaming the slug in place carries
   every one of those links across without touching a server. Offline as
   well as online — a rename is something the definition says, and needs
   nothing from upstream. */
async function renameVersions(game: GameDefinition): Promise<number> {
  let renamed = 0;

  for (const version of game.versions) {
    for (const formerId of version.formerIds ?? []) {
      const former = await db.gameVersion.findUnique({
        where: { gameId_slug: { gameId: game.id, slug: formerId } },
        select: { id: true },
      });
      if (!former) continue;

      const current = await db.gameVersion.findUnique({
        where: { gameId_slug: { gameId: game.id, slug: version.id } },
        select: { id: true },
      });

      if (!current) {
        await db.gameVersion.update({ where: { id: former.id }, data: { slug: version.id } });
      } else {
        /* Both exist — a sync ran on the new definition before this code
           did. The servers move to the row that will keep being synced,
           and the old one goes: nothing links to it any more. */
        await db.server.updateMany({
          where: { gameVersionId: former.id },
          data: { gameVersionId: current.id },
        });
        await db.gameVersion.delete({ where: { id: former.id } });
      }
      renamed++;
    }
  }
  return renamed;
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
    include: { game: { select: { id: true, family: true, name: true } } },
  });

  let linked = 0;
  for (const server of servers) {
    const inFamily = versions.filter((v) => v.game.family === server.game);
    if (inFamily.length === 0) continue;

    /* An exact label first, then by the number and the software in the
       stored label — "1.21.4 · Paper" was written by hand before versions
       had ids, so it will not match exactly. */
    const match =
      inFamily.find((v) => v.label === server.version) ?? matchByUpstream(inFamily, server.version);
    if (!match) continue;

    await db.server.update({
      where: { id: server.id },
      data: { gameId: match.game.id, gameVersionId: match.id },
    });
    linked++;
  }
  return linked;
}

/* "1.21.4 · Fabric" names a number and a piece of software, and four
   versions share that number. The first of them used to win, which
   linked a Fabric server to Paper and a Purpur server to the only 1.20.6
   there was.

   A wrong link is worse than none now that the link decides which
   updates a server is offered. So both labels are reduced to what is
   left once the number and the game's name are taken out — "fabric" —
   and a version matches only when that is the same on both sides, both
   ways round: "Minecraft 1.20.6" names no software and so cannot vouch
   for a server that says Purpur. More than one match links nothing. */
function matchByUpstream<
  V extends { label: string; upstream: string | null; game: { name: string; family: string } },
>(versions: V[], label: string): V | undefined {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const stored = words(label);

  const matches = versions.filter((v) => {
    if (!v.upstream || !stored.includes(v.upstream.toLowerCase())) return false;
    const generic = new Set([...words(v.game.name), ...words(v.game.family), v.upstream.toLowerCase()]);
    const theirs = new Set(words(v.label).filter((w) => !generic.has(w)));
    const ours = new Set(stored.filter((w) => !generic.has(w)));
    return theirs.size === ours.size && [...theirs].every((w) => ours.has(w));
  });

  return matches.length === 1 ? matches[0] : undefined;
}

function parseReleased(released: string | undefined): Date | null {
  if (!released) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(released) ? `${released}T00:00:00Z` : released);
  return Number.isNaN(date.getTime()) ? null : date;
}
