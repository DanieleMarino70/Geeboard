import { PlatformError } from "../errors";
import type { Architecture, GameDefinition, OperatingSystem, VersionChannel } from "./types";

/* Version resolution.

   "Latest" means at least five different things and they are routinely
   not the same number:

     game latest        what the game itself is on
     server latest      the newest dedicated server build that exists
     supported latest   the newest one Geeboard will actually install
     installed          what this server is running now
     recommended        what we would put on a new server today

   Terraria has shipped a client update days before the dedicated server
   caught up; Zomboid's unstable branch is numerically ahead of the
   branch almost everybody runs. Collapsing these into one field is how a
   panel ends up offering an update that cannot be installed, so they
   stay separate all the way to the UI. */

export interface VersionCandidate {
  id: string;
  label: string;
  /** The upstream version string, when the game has one. */
  upstream?: string;
  image?: string;
  note?: string;
  /** ISO date where known. */
  released?: string;
  channel: VersionChannel;
  recommended: boolean;
  /** False for a version we can see but will not install. */
  supported: boolean;
  download?: { url: string; sha256?: string };
  os?: OperatingSystem[];
  arch?: Architecture[];
  env?: Record<string, string>;
  /** Which provider spoke for this version. */
  providerId: string;
}

export interface IGameVersionProvider {
  readonly id: string;
  /** Every version this provider can offer for the game. */
  list(game: GameDefinition): Promise<VersionCandidate[]>;
  /* The newest version upstream has, installable or not. Optional
     because most sources cannot tell the difference between "the newest
     thing you can download" and "the newest thing that exists". */
  latestUpstream?(game: GameDefinition): Promise<{ game?: string; server?: string } | null>;
}

/* ── Comparing versions ───────────────────────────────────────────
   Game version strings are dotted and mostly numeric — 1.21.4, 1.4.4.9,
   41.78.16 — but not reliably so, and none of them are semver. Numeric
   segments compare as numbers so 1.10 beats 1.9; anything else falls
   back to a string comparison, which at least is stable. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/[.\-_+]/).filter((s) => s.length > 0);
  const left = split(a);
  const right = split(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    // A missing segment is older: 1.21 comes before 1.21.4.
    if (l === undefined) return -1;
    if (r === undefined) return 1;

    const ln = Number(l);
    const rn = Number(r);
    if (Number.isInteger(ln) && Number.isInteger(rn)) {
      if (ln !== rn) return ln < rn ? -1 : 1;
      continue;
    }
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** The newer of two version strings, tolerating a missing one. */
export function newerOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return compareVersions(a, b) >= 0 ? a : b;
}

/* ── The static provider ──────────────────────────────────────────
   Everything a definition ships with. Always registered, always first,
   and the only provider that cannot fail — which matters, because a
   network provider having a bad day must never empty the version list. */
export const staticProvider: IGameVersionProvider = {
  id: "static",
  async list(game) {
    return game.versions.map((version) => ({
      id: version.id,
      label: version.label,
      upstream: version.upstream,
      image: version.image,
      note: version.note,
      released: version.released,
      channel: version.channel,
      recommended: version.recommended === true,
      supported: version.supported !== false,
      download: version.download,
      env: version.env,
      providerId: "static",
    }));
  },
};

/* ── Provider registry ────────────────────────────────────────────
   A definition names the providers that may speak for it. Naming one
   that is not registered is not an error: Phase 2 adds the Steam and
   GitHub providers, and until then a definition saying where its
   versions will eventually come from is more useful than one that does
   not. Unregistered providers are simply skipped. */
const PROVIDERS = new Map<string, IGameVersionProvider>([[staticProvider.id, staticProvider]]);

export function registerVersionProvider(provider: IGameVersionProvider): void {
  PROVIDERS.set(provider.id, provider);
}

export function versionProvider(id: string): IGameVersionProvider | undefined {
  return PROVIDERS.get(id);
}

export function registeredProviders(): string[] {
  return [...PROVIDERS.keys()];
}

/* ── Resolution ───────────────────────────────────────────────────── */

export interface VersionCatalog {
  gameId: string;
  /** Every version any provider offered, newest first. */
  candidates: VersionCandidate[];
  /** What the game itself is on, installable or not. */
  gameLatest: string | null;
  /** The newest dedicated server build that exists upstream. */
  serverLatest: string | null;
  /** The newest version Geeboard will actually install. */
  supportedLatest: VersionCandidate | null;
  /** What a new server should be given today. */
  recommended: VersionCandidate | null;
  /** A provider that failed is reported, never swallowed. */
  providerErrors: Array<{ provider: string; message: string }>;
}

/* Newest first, and a stable order for versions we cannot date: a list
   that reshuffles between two renders is worse than one that is wrong
   in a predictable way. */
function rank(a: VersionCandidate, b: VersionCandidate): number {
  if (a.upstream && b.upstream) {
    const byVersion = compareVersions(b.upstream, a.upstream);
    if (byVersion !== 0) return byVersion;
  }
  if (a.released && b.released && a.released !== b.released) {
    return a.released < b.released ? 1 : -1;
  }
  return a.id.localeCompare(b.id);
}

const CHANNEL_RANK: Record<VersionChannel, number> = {
  stable: 3,
  legacy: 2,
  snapshot: 1,
  preview: 0,
};

export async function resolveVersions(game: GameDefinition): Promise<VersionCatalog> {
  const providerErrors: VersionCatalog["providerErrors"] = [];
  const byId = new Map<string, VersionCandidate>();
  let gameLatest: string | null = null;
  let serverLatest: string | null = null;

  for (const id of game.versionProviders) {
    const provider = PROVIDERS.get(id);
    // Named but not built yet — see the note on the registry above.
    if (!provider) continue;

    try {
      for (const candidate of await provider.list(game)) {
        /* First provider to claim an id wins. Definitions are listed
           first, so a definition can always overrule what a remote
           source says about a version it has an opinion about. */
        if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
        if (candidate.upstream) serverLatest = newerOf(serverLatest, candidate.upstream);
      }

      const latest = await provider.latestUpstream?.(game);
      if (latest) {
        gameLatest = newerOf(gameLatest, latest.game);
        serverLatest = newerOf(serverLatest, latest.server);
      }
    } catch (error) {
      providerErrors.push({
        provider: id,
        message: error instanceof Error ? error.message : "the provider failed",
      });
    }
  }

  const candidates = [...byId.values()].sort(rank);
  const installable = candidates.filter((c) => c.supported);

  /* The newest one we would install, preferring a stable channel: a
     preview build being numerically ahead does not make it the version
     to offer an operator who has not asked for one. */
  const supportedLatest =
    [...installable].sort((a, b) => {
      const byChannel = CHANNEL_RANK[b.channel] - CHANNEL_RANK[a.channel];
      return byChannel !== 0 ? byChannel : rank(a, b);
    })[0] ?? null;

  const recommended = installable.find((c) => c.recommended) ?? supportedLatest;

  // Nothing said what the game itself is on, so the best we know is the
  // newest server build anyone offered.
  if (!gameLatest) gameLatest = serverLatest;

  return {
    gameId: game.id,
    candidates,
    gameLatest,
    serverLatest,
    supportedLatest,
    recommended,
    providerErrors,
  };
}

/* ── What to tell an operator ─────────────────────────────────────── */

export interface VersionOutlook {
  installed: string | null;
  installedLabel: string | null;
  gameLatest: string | null;
  serverLatest: string | null;
  supportedLatest: string | null;
  recommended: string | null;
  recommendedVersionId: string | null;
  updateAvailable: boolean;
  /* True when the game has moved on but Geeboard cannot install the new
     version yet. Worth saying out loud rather than showing "up to date"
     to somebody who can see the news. */
  aheadOfSupport: boolean;
}

export function outlookFor(catalog: VersionCatalog, installedVersionId: string | null): VersionOutlook {
  const installed = installedVersionId
    ? (catalog.candidates.find((c) => c.id === installedVersionId) ?? null)
    : null;

  const installedUpstream = installed?.upstream ?? null;
  const supportedLatest = catalog.supportedLatest?.upstream ?? null;

  const updateAvailable = Boolean(
    catalog.supportedLatest &&
      installed &&
      catalog.supportedLatest.id !== installed.id &&
      (!installedUpstream ||
        !supportedLatest ||
        compareVersions(supportedLatest, installedUpstream) > 0),
  );

  const aheadOfSupport = Boolean(
    catalog.gameLatest && supportedLatest && compareVersions(catalog.gameLatest, supportedLatest) > 0,
  );

  return {
    installed: installedUpstream,
    installedLabel: installed?.label ?? null,
    gameLatest: catalog.gameLatest,
    serverLatest: catalog.serverLatest,
    supportedLatest,
    recommended: catalog.recommended?.upstream ?? null,
    recommendedVersionId: catalog.recommended?.id ?? null,
    updateAvailable,
    aheadOfSupport,
  };
}

/** The candidate an operation was asked for, or a refusal that says why. */
export function requireCandidate(catalog: VersionCatalog, versionId: string): VersionCandidate {
  const candidate = catalog.candidates.find((c) => c.id === versionId);
  if (!candidate) {
    throw new PlatformError("GAME_VERSION_NOT_FOUND", "That version is not in the catalog.", {
      details: { gameId: catalog.gameId, versionId },
    });
  }
  if (!candidate.supported) {
    throw new PlatformError("GAME_VERSION_UNSUPPORTED", `Geeboard does not install ${candidate.label}.`, {
      details: { gameId: catalog.gameId, versionId },
    });
  }
  return candidate;
}
