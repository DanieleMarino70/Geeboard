import { PlatformError, asPlatformError } from "../errors";
import type {
  Architecture,
  GameDefinition,
  OperatingSystem,
  VersionChannel,
  VersionSourceRef,
} from "./types";

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

  /* ── Steam ──────────────────────────────────────────────────────
     A Steam game has no version number. It has a branch and a build id,
     and the build id is the only thing that changes when the game
     updates. These are kept in their own fields and never folded into
     `upstream`, because a build id sorts above every real version string
     a game ever had and would corrupt every comparison below. */
  /** The Steam branch this version tracks. */
  branch?: string;
  /** The branch's current build id, as an integer string. */
  buildId?: string;
  /** When that build was published. */
  updatedAt?: string | null;

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
   A definition names a source and its arguments; a factory turns that
   into a provider. Keeping factories rather than instances is what lets
   one provider serve several games with different app ids and repos.

   A source naming a factory that is not registered is skipped rather
   than treated as an error — a definition may legitimately describe
   where its versions will come from before that provider exists. */
export interface ProviderOptions {
  /* Bypass whatever the provider caches. The catalog sync passes this;
     a page render never should — see providers/http.ts. */
  refresh?: boolean;
}

export type ProviderFactory = (
  ref: VersionSourceRef,
  options: ProviderOptions,
) => IGameVersionProvider;

const FACTORIES = new Map<string, ProviderFactory>([["static", () => staticProvider]]);

export function registerVersionProvider(name: string, factory: ProviderFactory): void {
  FACTORIES.set(name, factory);
}

export function registeredProviders(): string[] {
  return [...FACTORIES.keys()];
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

export interface ResolveOptions {
  /* Bypass the provider cache. The catalog sync passes this; a page
     render never should — see providers/http.ts. */
  refresh?: boolean;
}

export async function resolveVersions(
  game: GameDefinition,
  options: ResolveOptions = {},
): Promise<VersionCatalog> {
  const providerErrors: VersionCatalog["providerErrors"] = [];
  const byId = new Map<string, VersionCandidate>();
  const fromProviders: VersionCandidate[] = [];
  let gameLatest: string | null = null;
  let serverLatest: string | null = null;

  for (const ref of game.versionSources) {
    const factory = FACTORIES.get(ref.provider);
    // Named but not built yet — see the note on the registry above.
    if (!factory) continue;

    try {
      const provider = factory(ref, { refresh: options.refresh });
      for (const candidate of await provider.list(game)) {
        fromProviders.push(candidate);
        /* First provider to claim an id wins. Definitions are listed
           first, so a definition can always overrule what a remote
           source says about a version it has an opinion about. */
        if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);

        /* Only a real version string moves "server latest". A Steam
           build id is not one, and letting it in here is exactly the
           mistake this whole shape exists to prevent. */
        if (candidate.upstream) serverLatest = newerOf(serverLatest, candidate.upstream);
      }

      const latest = await provider.latestUpstream?.(game);
      if (latest) {
        gameLatest = newerOf(gameLatest, latest.game);
        serverLatest = newerOf(serverLatest, latest.server);
      }
    } catch (error) {
      providerErrors.push({ provider: ref.provider, message: asPlatformError(error).message });
    }
  }

  mergeBranches(game, byId, fromProviders);

  return summariseCatalog(game.id, [...byId.values()], {
    gameLatest,
    serverLatest,
    providerErrors,
  });
}

/* Works out a catalog's summary fields from its candidates.

   Exported because the same question gets asked twice: once here, of
   what providers just returned, and once of the rows the sync wrote —
   see lib/catalog-read.ts. Two implementations of "which version is the
   newest supported one" would eventually disagree, and the disagreement
   would show up as a panel that recommends one thing and installs
   another. */
export function summariseCatalog(
  gameId: string,
  input: VersionCandidate[],
  extras: {
    gameLatest?: string | null;
    serverLatest?: string | null;
    providerErrors?: VersionCatalog["providerErrors"];
  } = {},
): VersionCatalog {
  const candidates = [...input].sort(rank);
  const installable = candidates.filter((c) => c.supported);

  /* The newest one we would install, preferring a stable channel: a
     preview build being numerically ahead does not make it the version
     to offer an operator who has not asked for one. */
  const supportedLatest =
    [...installable].sort((a, b) => {
      const byChannel = CHANNEL_RANK[b.channel] - CHANNEL_RANK[a.channel];
      return byChannel !== 0 ? byChannel : rank(a, b);
    })[0] ?? null;

  let serverLatest = extras.serverLatest ?? null;
  for (const candidate of candidates) {
    // Only a real version string. A build id is not one.
    if (candidate.upstream) serverLatest = newerOf(serverLatest, candidate.upstream);
  }

  // Nothing said what the game itself is on, so the best we know is the
  // newest server build anyone offered.
  const gameLatest = newerOf(extras.gameLatest ?? null, serverLatest);

  return {
    gameId,
    candidates,
    gameLatest,
    serverLatest,
    supportedLatest,
    recommended: installable.find((c) => c.recommended) ?? supportedLatest,
    providerErrors: extras.providerErrors ?? [],
  };
}

/* Folds a Steam branch's build id onto the version that tracks it.

   A branch is not a version — it is a moving pointer, and what an
   operator installs is a version that follows it. So the build id
   belongs on that version, where "has this server's branch moved since
   it was installed?" becomes answerable, and the branch's own row is
   dropped once it has been merged. A branch nothing tracks is left in
   the list, unsupported: worth knowing it exists, not worth installing. */
function mergeBranches(
  game: GameDefinition,
  byId: Map<string, VersionCandidate>,
  fromProviders: VersionCandidate[],
) {
  const branches = new Map<string, VersionCandidate>();
  for (const candidate of fromProviders) {
    if (candidate.branch && candidate.buildId) branches.set(candidate.branch, candidate);
  }
  if (branches.size === 0) return;

  const merged = new Set<string>();
  for (const version of game.versions) {
    if (!version.steamBranch) continue;
    const branch = branches.get(version.steamBranch);
    const target = byId.get(version.id);
    if (!branch || !target) continue;

    target.branch = branch.branch;
    target.buildId = branch.buildId;
    target.updatedAt = branch.updatedAt;
    /* The branch's publication date is more truthful than a date
       somebody typed into a definition, so it wins where we have it. */
    if (branch.released) target.released = branch.released;
    merged.add(branch.id);
  }

  for (const id of merged) byId.delete(id);
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

  /* ── Steam ──────────────────────────────────────────────────────
     For a game with no version number at all — Rust — this is the only
     thing that can answer "is there an update?". The branch moved; the
     version string it goes by did not, because there isn't one. */
  branch: string | null;
  installedBuildId: string | null;
  currentBuildId: string | null;
  branchUpdatedAt: string | null;
  buildDrift: boolean;
}

export interface OutlookInput {
  versionId: string | null;
  /** The build id recorded when this server was last installed or updated. */
  buildId?: string | null;
}

export function outlookFor(
  catalog: VersionCatalog,
  installed: string | null | OutlookInput,
): VersionOutlook {
  const input: OutlookInput =
    installed === null || typeof installed === "string" ? { versionId: installed } : installed;

  const current = input.versionId
    ? (catalog.candidates.find((c) => c.id === input.versionId) ?? null)
    : null;

  const installedUpstream = current?.upstream ?? null;
  const supportedLatest = catalog.supportedLatest?.upstream ?? null;

  const versionUpdate = Boolean(
    catalog.supportedLatest &&
      current &&
      catalog.supportedLatest.id !== current.id &&
      (!installedUpstream ||
        !supportedLatest ||
        compareVersions(supportedLatest, installedUpstream) > 0),
  );

  /* A build id is an integer that only goes up, so "different" and
     "newer" are the same question — but only within one branch, since
     two branches' build ids say nothing about each other. */
  const currentBuildId = current?.buildId ?? null;
  const buildDrift = Boolean(input.buildId && currentBuildId && input.buildId !== currentBuildId);

  const aheadOfSupport = Boolean(
    catalog.gameLatest && supportedLatest && compareVersions(catalog.gameLatest, supportedLatest) > 0,
  );

  return {
    installed: installedUpstream,
    installedLabel: current?.label ?? null,
    gameLatest: catalog.gameLatest,
    serverLatest: catalog.serverLatest,
    supportedLatest,
    recommended: catalog.recommended?.upstream ?? null,
    recommendedVersionId: catalog.recommended?.id ?? null,
    updateAvailable: versionUpdate || buildDrift,
    aheadOfSupport,
    branch: current?.branch ?? null,
    installedBuildId: input.buildId ?? null,
    currentBuildId,
    branchUpdatedAt: current?.updatedAt ?? null,
    buildDrift,
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
