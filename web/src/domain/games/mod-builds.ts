import type { ModLayout } from "./types";

/* Which mods in a download a build of the game will load, and which it
   will not see — from what the node found on disk and the server's
   version, with no network and no node.

   Everything here was measured on the game's own images, 41.78.19 and
   42.20.4, in September 2026, with test mods whose Lua printed which
   folder they were loaded from:

   From Build 42 on (the "versioned" layout):
     - A mod keeps its files in folders named for game versions — `42`,
       `42.0`, `42.10` — beside a `common/` that is always read too.
     - The game reads exactly one version folder: the highest whose
       major.minor is not above its own. On 42.20.4, of `42.10` and
       `42.20.5` it read `42.20.5`; of `42.9` and `42.10`, `42.10`; of
       `42.21` and `43`, neither. Among folders with the same major.minor
       the highest wins.
     - Its mod.info is that folder's, or `common/`'s when that folder has
       none. There is no falling back to a lower folder: with a mod.info
       in `42.0/` only, and an empty `42.10/` beside it, the mod was not
       found.
     - A mod.info at the top of the mod's directory — the Build 41 layout
       — is not read at all, even when it is the only one.
   Before Build 42 (the "top" layout):
     - Only the mod.info at the top is read; version folders are ignored.
   On both:
     - `versionMin` and `versionMax` in the mod.info that was read hide
       the mod when the game is outside them, compared on major.minor:
       42.20.4 loads a mod with `versionMax=42.20` or `versionMin=42.20.5`,
       and not one with `versionMax=42.19`.
     - A bound that is not major.minor — `versionMax=42`, `versionMin=abc`
       — is refused as "invalid game version", and the mod with it.
     - A mod the game cannot see is logged as "required mod not found"
       and the server starts without it. It does not refuse to start, on
       either build, which is why the panel has to say so: nothing else
       will, short of somebody reading the log. */

/** One mod.info as the node reported it. */
export interface ModInfoFacts {
  /** "common", "42.0" — empty for one at the top of the mod's directory. */
  folder: string;
  id: string;
  name: string;
  versionMin: string | null;
  versionMax: string | null;
  /** `require=`, as written: the mods it needs. See judgeServer. */
  require?: string[];
}

/** One mod inside a download, as the node found it on disk. */
export interface ModFacts {
  dir: string;
  folders: string[];
  infos: ModInfoFacts[];
}

export type ModRefusal =
  /** Only a mod.info at the top, which a versioned build does not read. */
  | { kind: "older-layout" }
  /** Only version folders, which a top-layout build does not read. */
  | { kind: "newer-layout" }
  /** The folder this build reads, and `common/`, have no mod.info between them. */
  | { kind: "no-info"; folder: string | null }
  | { kind: "below-min"; bound: string }
  | { kind: "above-max"; bound: string }
  | { kind: "bad-bound"; field: "versionMin" | "versionMax"; bound: string }
  /** Its `require=` names mods this server does not have, or has and will not load. */
  | { kind: "missing-requirement"; requires: string[] };

export type ModVerdict =
  | { loads: true; id: string; name: string; folder: string }
  | { loads: false; id: string; name: string; refusal: ModRefusal };

export interface VersionNumbers {
  major: number;
  minor: number;
  patch: number;
}

/* A game version as the game reads a bound: major.minor, and a patch
   that it parses and then does not compare. A bare major is not one. */
function bound(text: string): VersionNumbers | null {
  const match = /^\s*(\d{1,4})\.(\d{1,4})(?:\.(\d{1,6}))?\s*$/.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/* A folder name: a bare major counts here, as `42/` does on disk. */
function folderVersion(name: string): VersionNumbers | null {
  const match = /^(\d{1,4})(?:\.(\d{1,4}))?(?:\.(\d{1,6}))?$/.exec(name);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
}

/** Compared the way the game compares: major and minor, never the patch. */
function line(a: VersionNumbers, b: VersionNumbers): number {
  return a.major - b.major || a.minor - b.minor;
}

function full(a: VersionNumbers, b: VersionNumbers): number {
  return line(a, b) || a.patch - b.patch;
}

/** The game's own version: "42.20.4". Read as leniently as a folder, since it comes from a definition. */
export function gameVersionOf(upstream: string | undefined): VersionNumbers | null {
  return upstream ? folderVersion(upstream.trim()) : null;
}

/** Which layout a game version reads mods in. A game that declares none reads the top. */
export function layoutFor(layout: ModLayout | undefined, game: VersionNumbers): "versioned" | "top" {
  const from = layout ? folderVersion(layout.versionFoldersFrom) : null;
  return from && line(game, from) >= 0 ? "versioned" : "top";
}

/** The version folder a versioned build reads, of those a mod has. Null when none fits. */
export function chosenFolder(folders: string[], game: VersionNumbers): string | null {
  let best: { name: string; version: VersionNumbers } | null = null;
  for (const name of folders) {
    const version = folderVersion(name);
    if (!version || line(version, game) > 0) continue;
    if (!best || full(version, best.version) > 0) best = { name, version };
  }
  return best?.name ?? null;
}

export function judgeMod(mod: ModFacts, layout: ModLayout | undefined, game: VersionNumbers): ModVerdict {
  const top = mod.infos.find((info) => info.folder === "");
  const fallback = top ?? mod.infos[0];
  const named = { id: fallback?.id ?? mod.dir, name: fallback?.name ?? mod.dir };

  let info: ModInfoFacts | undefined;
  if (layout && layoutFor(layout, game) === "versioned") {
    const folder = chosenFolder(mod.folders, game);
    info =
      (folder !== null ? mod.infos.find((i) => i.folder === folder) : undefined) ??
      mod.infos.find((i) => i.folder === layout.common);
    if (!info) {
      const onlyTop = top !== undefined && mod.infos.every((i) => i.folder === "");
      return { loads: false, ...named, refusal: onlyTop ? { kind: "older-layout" } : { kind: "no-info", folder } };
    }
  } else {
    info = top;
    if (!info) return { loads: false, ...named, refusal: { kind: "newer-layout" } };
  }

  const result = { id: info.id, name: info.name };
  for (const field of ["versionMin", "versionMax"] as const) {
    const text = info[field];
    if (text === null) continue;
    const parsed = bound(text);
    if (!parsed) return { loads: false, ...result, refusal: { kind: "bad-bound", field, bound: text } };
    if (field === "versionMin" && line(game, parsed) < 0) {
      return { loads: false, ...result, refusal: { kind: "below-min", bound: text } };
    }
    if (field === "versionMax" && line(game, parsed) > 0) {
      return { loads: false, ...result, refusal: { kind: "above-max", bound: text } };
    }
  }
  return { loads: true, ...result, folder: info.folder };
}

/* One line for a person, beside the mod. `version` is what the server
   runs, as the panel shows it — "42.20.4" — and `build` its name, "Build
   42", so the sentence names the thing the operator chose. */
export function refusalText(refusal: ModRefusal, build: string, version: string): string {
  switch (refusal.kind) {
    case "older-layout":
      return `Laid out for an older build: ${build} does not look where it keeps its mod.info.`;
    case "newer-layout":
      return `Laid out for a newer build: ${build} does not read version folders.`;
    case "no-info":
      return refusal.folder
        ? `No mod.info in ${refusal.folder}/ or common/, which is where ${version} looks.`
        : `No folder for ${version} and no mod.info in common/.`;
    case "below-min":
      return `Needs ${refusal.bound} or later, and this server is ${version}.`;
    case "above-max":
      return `Made for ${refusal.bound} and earlier, and this server is ${version}.`;
    case "bad-bound":
      return `Its mod.info gives ${refusal.field} as “${refusal.bound}”, which the game refuses as a version.`;
    case "missing-requirement":
      return `Needs ${refusal.requires.join(", ")}, which ${refusal.requires.length === 1 ? "is" : "are"} not on this server — or not something ${build} loads.`;
  }
}

/* ── What a mod needs ────────────────────────────────────────────────
   Measured on 42.20.4, with test mods whose `require=` pointed at other
   test mods:
     - a mod that requires one the game cannot find is not loaded, and
       is logged "required mod not found" under its own name — and so is
       a mod that requires that one, all the way up;
     - a mod that requires one that is downloaded but not in the load
       list loads, and brings it with it: the game loads what is required
       whether it was listed or not;
     - `require=\X` and `require=X` mean the same; Build 42's authors
       write the backslash.
   And on 41.78.19 the same, except the backslash: there `require=\X`
   names a mod called `\X`, which is never found.
   So whether a mod loads depends on the rest of the server, and is
   judged over all of it at once. */

/* The mod ids a `require=` names. A build that reads version folders
   takes the backslash Build 42 writes before each as punctuation; one
   that does not takes it as part of the name. */
export function requiredIds(info: Pick<ModInfoFacts, "require">, layout: "versioned" | "top"): string[] {
  return (info.require ?? [])
    .map((entry) => (layout === "versioned" ? entry.slice(entry.lastIndexOf("\\") + 1) : entry).trim())
    .filter((id) => id.length > 0);
}

/* Every mod on a server, judged together: first each against the build,
   then again against each other until nothing changes — a mod whose
   requirement is refused is refused too. Requirements are met by any
   mod the server has downloaded and the build reads, switched on or not,
   because the game loads a required mod whether it was listed or not. */
export function judgeServer(mods: ModFacts[], layout: ModLayout | undefined, game: VersionNumbers): ModVerdict[] {
  const verdicts = mods.map((mod) => judgeMod(mod, layout, game));
  const kind = layoutFor(layout, game);
  const needs = mods.map((mod, i) => {
    const verdict = verdicts[i]!;
    const info = verdict.loads ? mod.infos.find((candidate) => candidate.folder === verdict.folder) : undefined;
    return info ? requiredIds(info, kind) : [];
  });

  for (let changed = true; changed; ) {
    changed = false;
    const available = new Set(verdicts.filter((verdict) => verdict.loads).map((verdict) => verdict.id));
    verdicts.forEach((verdict, i) => {
      if (!verdict.loads) return;
      const missing = needs[i]!.filter((id) => !available.has(id));
      if (missing.length === 0) return;
      verdicts[i] = { loads: false, id: verdict.id, name: verdict.name, refusal: { kind: "missing-requirement", requires: missing } };
      changed = true;
    });
  }
  return verdicts;
}

/* ── What the Workshop's tags say ────────────────────────────────────
   Before anything is downloaded, the only word on which build an item
   is for is its tags, which its author wrote. They are right often and
   wrong sometimes, so they warn and never refuse: the node's answer
   after the download is the one that decides. */

/** The builds an item's tags name, by the tag: ["Build 41"]. */
export function buildTagsOf(tags: string[], known: Record<string, number>): string[] {
  return tags.filter((tag) => tag in known);
}

/** The tag naming this server's build, when the definition knows one. */
export function tagForBuild(known: Record<string, number>, game: VersionNumbers): string | null {
  return Object.entries(known).find(([, major]) => major === game.major)?.[0] ?? null;
}

/** Tagged for other builds and not this one: the tags it has instead. Null when that is not so. */
export function otherBuildOnly(tags: string[], known: Record<string, number>, game: VersionNumbers): string[] | null {
  const builds = buildTagsOf(tags, known);
  if (builds.length === 0) return null;
  return builds.some((tag) => known[tag] === game.major) ? null : builds;
}

/* "5 for Build 42, 1 for Build 41 only" — about a list of items before
   any is added. Null when nothing in it is tagged with a build at all,
   which says nothing either way. */
export function buildSummary(items: Array<{ tags: string[] }>, known: Record<string, number>, game: VersionNumbers): string | null {
  const own = tagForBuild(known, game);
  let forThis = 0;
  let untagged = 0;
  const others = new Map<string, number>();
  for (const item of items) {
    const builds = buildTagsOf(item.tags, known);
    if (builds.length === 0) untagged++;
    else if (builds.some((tag) => known[tag] === game.major)) forThis++;
    else {
      const key = builds.join(" and ");
      others.set(key, (others.get(key) ?? 0) + 1);
    }
  }
  if (forThis === 0 && others.size === 0) return null;

  const parts = [
    ...(forThis > 0 && own ? [`${forThis} for ${own}`] : []),
    ...[...others].map(([tags, count]) => `${count} for ${tags} only`),
    ...(untagged > 0 ? [`${untagged} not tagged with a build`] : []),
  ];
  return parts.join(", ");
}
