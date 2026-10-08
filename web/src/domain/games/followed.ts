import { compareVersions } from "./versions";
import type { GameDefinition, GameVersion, TagFollow, TagFollowLine } from "./types";

/* Versions found as the tags of a game's image.

   A definition pins each version to a tag. For a game that updates every few
   weeks that meant a release of Geeboard per update, and in between the panel
   said "update available" (Steam had moved) while no version named the tag that
   carries it: the update re-pulled the pinned tag, and nothing changed.

   A definition that names its image's repository and which tags are releases of
   which line (TagFollow) gets the newer ones from the registry instead. This
   file is the part that needs no network and no database — what a list of tags
   turns into — so the same rules decide it in the poller, the panel and the
   browser, and a test can say what they are.

   What it does not do is trust a tag more than the definition does. Only the
   repository the definition's own images are in is read, only a tag the
   definition's pattern accepts becomes a version, and a followed version is a
   copy of the newest version the definition ships for that line: the same
   settings, the same environment, the same Steam branch. Nothing moves a server
   to it; an operator chooses, as for any other version. */

/** A tag as the registry lists it. */
export interface TagRecord {
  name: string;
  /** When it was pushed, ISO; null for a tag known only from a stored version. */
  pushedAt: string | null;
}

/** A Docker Hub repository: an owner, a slash and a name, in the characters a repository may have. */
export const REPOSITORY = /^[a-z0-9][a-z0-9._-]{1,63}\/[a-z0-9][a-z0-9._-]{1,127}$/;

/* What a game version string looks like, here: numbers and dots. A tag is whatever its maker typed, and this
   ends up in an id, a label and a comparison. */
const VERSION_STRING = /^\d+(?:\.\d+){1,3}$/;

/** The image without its tag or digest: "owner/name:1.2" is "owner/name". */
export function repositoryOf(image: string): string {
  const slash = image.lastIndexOf("/") + 1;
  return image.slice(0, slash) + image.slice(slash).split(/[:@]/)[0]!;
}

/** The tag of an image in the repository, or null when it is in another or names none. */
export function tagOf(image: string, repository: string): string | null {
  if (!image.startsWith(`${repository}:`)) return null;
  const tag = image.slice(repository.length + 1).split("@")[0]!;
  return tag.length > 0 ? tag : null;
}

/** The pattern of a line as a regular expression that has to match the whole tag, or null when it is not one. */
export function tagPattern(rule: TagFollowLine): RegExp | null {
  try {
    return new RegExp(`^(?:${rule.tag})$`);
  } catch {
    return null;
  }
}

interface Release {
  tag: string;
  version: string;
  rebuild: number;
  pushedAt: string | null;
}

function readTag(pattern: RegExp, tag: TagRecord): Release | null {
  const groups = pattern.exec(tag.name)?.groups;
  const version = groups?.version;
  if (!version || !VERSION_STRING.test(version)) return null;
  const rebuild = groups.rebuild === undefined ? 0 : Number(groups.rebuild);
  if (!Number.isSafeInteger(rebuild)) return null;
  return { tag: tag.name, version, rebuild, pushedAt: tag.pushedAt };
}

/* The version of a line that a followed one is made from: the newest the definition ships and installs. Absent
   when the line has none, or none that says what version it is. */
export function templateOf(versions: readonly GameVersion[], line: string): GameVersion | undefined {
  return versions
    .filter((v) => !v.followed && v.supported !== false && v.upstream !== undefined && (v.line ?? "") === line)
    .sort((a, b) => compareVersions(b.upstream!, a.upstream!))[0];
}

/** The id of the version that follows a tag: its template's, and the game's version with the dots made dashes. */
export function followedId(template: GameVersion, version: string): string {
  return `${template.id}-${version.replaceAll(".", "-")}`;
}

/* The versions the tags add to a game.

   Per line: the releases newer than the template, one for each version of the
   game (the highest rebuild of it, "42.21-release-2" over "42.21-release"),
   newest first. The newest of a line takes over `recommended` from the template,
   so a new server starts on it. A tag older than what the definition ships, or
   the same version as it, adds nothing: the definition's word on a version it
   has an opinion about wins. */
export function followedVersions(game: GameDefinition, tags: readonly TagRecord[]): GameVersion[] {
  const follow = game.followTags;
  if (!follow) return [];

  const taken = new Set(game.versions.filter((v) => !v.followed).map((v) => v.id));
  const out: GameVersion[] = [];
  for (const rule of follow.lines) {
    const template = templateOf(game.versions, rule.line);
    const pattern = tagPattern(rule);
    if (!template || !pattern || repositoryOf(template.image) !== follow.repository) continue;

    const best = new Map<string, Release>();
    for (const tag of tags) {
      const release = readTag(pattern, tag);
      if (!release || compareVersions(release.version, template.upstream!) <= 0) continue;
      const have = best.get(release.version);
      if (!have || release.rebuild > have.rebuild || (release.rebuild === have.rebuild && (release.pushedAt ?? "") > (have.pushedAt ?? ""))) {
        best.set(release.version, release);
      }
    }

    const releases = [...best.values()].sort((a, b) => compareVersions(b.version, a.version));
    releases.forEach((release, index) => {
      const id = followedId(template, release.version);
      if (taken.has(id)) return;
      out.push({
        id,
        followed: true,
        line: template.line,
        label: `${template.label} · ${release.version}`,
        upstream: release.version,
        image: `${follow.repository}:${release.tag}`,
        note: template.note,
        released: release.pushedAt?.slice(0, 10) ?? template.released,
        channel: template.channel,
        ...(template.recommended && index === 0 ? { recommended: true } : {}),
        supported: true,
        // The branch is the newest version's: it moves to the next release the day that one is found, and is not shared.
        ...(template.steamBranch !== undefined && index === 0 ? { steamBranch: template.steamBranch } : {}),
        ...(template.env !== undefined ? { env: template.env } : {}),
        ...(template.args !== undefined ? { args: template.args } : {}),
      });
    });
  }
  return out;
}

/* What of a list of versions is a followed version of this game, as the game's own rules would have made it: in
   the repository, in a line, and not taking the id of a version the definition ships. The list a process was
   handed — by the poller's database, by the page to the browser — is read through this, so that what it holds
   cannot be an image from somewhere else. */
export function acceptFollowed(game: GameDefinition, versions: readonly GameVersion[]): GameVersion[] {
  const follow = game.followTags;
  if (!follow) return [];
  const lines = new Set(follow.lines.map((l) => l.line));
  const shipped = new Set(game.versions.filter((v) => !v.followed).map((v) => v.id));
  const seen = new Set<string>();
  return versions.filter((v) => {
    if (v.followed !== true || typeof v.id !== "string" || typeof v.image !== "string" || shipped.has(v.id) || seen.has(v.id)) return false;
    if (!lines.has(v.line ?? "") || tagOf(v.image, follow.repository) === null) return false;
    seen.add(v.id);
    return true;
  });
}

/* A shipped version in a line whose newest is a followed one: no longer the recommended one, and no longer the one that
   tracks the Steam branch. The branch's build id and date describe the newest build, and a version that is not it must not
   carry them (nor read as having drifted from them). */
function demote(version: GameVersion, recommended: ReadonlySet<string>, onBranch: ReadonlySet<string>): GameVersion {
  const line = version.line ?? "";
  const losesRecommended = version.recommended === true && recommended.has(line);
  const losesBranch = version.steamBranch !== undefined && onBranch.has(line);
  if (!losesRecommended && !losesBranch) return version;
  const demoted: GameVersion = { ...version };
  if (losesBranch) delete demoted.steamBranch;
  if (losesRecommended) demoted.recommended = false;
  return demoted;
}

/* The game with its followed versions in. Each goes in front of the version it was made from, so a list that is
   shown in order shows the newest first, and the version of a line that was recommended is not any more once a
   followed one is: a new server is put on the newest. */
export function withFollowed(game: GameDefinition, followed: readonly GameVersion[]): GameDefinition {
  if (followed.length === 0) return game;

  const recommended = new Set(followed.filter((v) => v.recommended).map((v) => v.line ?? ""));
  const onBranch = new Set(followed.filter((v) => v.steamBranch !== undefined).map((v) => v.line ?? ""));
  const templates = new Set(
    (game.followTags?.lines ?? []).map((l) => templateOf(game.versions, l.line)?.id).filter((id): id is string => id !== undefined),
  );
  const newestFirst = [...followed].sort((a, b) => compareVersions(b.upstream ?? "0", a.upstream ?? "0"));

  const versions: GameVersion[] = [];
  for (const version of game.versions) {
    if (templates.has(version.id)) versions.push(...newestFirst.filter((f) => (f.line ?? "") === (version.line ?? "")));
    versions.push(demote(version, recommended, onBranch));
  }
  return { ...game, versions };
}

/** What is wrong with a follow rule, in an author's words, for the audit; empty when the rule is sound. */
export function followProblems(game: Pick<GameDefinition, "id" | "versions">, follow: TagFollow): string[] {
  const problems: string[] = [];
  if (!REPOSITORY.test(follow.repository)) problems.push(`${game.id}: followTags names "${follow.repository}", which is not a Docker Hub repository`);
  if (follow.lines.length === 0) problems.push(`${game.id}: followTags follows no line`);

  const seen = new Set<string>();
  for (const rule of follow.lines) {
    if (seen.has(rule.line)) problems.push(`${game.id}: followTags follows the line "${rule.line}" twice`);
    seen.add(rule.line);

    const template = templateOf(game.versions, rule.line);
    if (!template) problems.push(`${game.id}: followTags follows the line "${rule.line}", which has no version that is installed and says its version`);
    else if (repositoryOf(template.image) !== follow.repository) problems.push(`${game.id}: the line "${rule.line}" is in ${repositoryOf(template.image)}, not in ${follow.repository}`);

    const pattern = tagPattern(rule);
    if (!pattern) problems.push(`${game.id}: the tag pattern of "${rule.line}" is not a regular expression`);
    else if (!rule.tag.includes("(?<version>")) problems.push(`${game.id}: the tag pattern of "${rule.line}" has no (?<version>…) group`);
  }
  return problems;
}
