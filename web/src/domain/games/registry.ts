import { PlatformError } from "../errors";
import { auditDefinition } from "./audit";
import { acceptFollowed, withFollowed } from "./followed";
import { GARRYS_MOD } from "./definitions/garrys-mod";
import { MINECRAFT_BEDROCK } from "./definitions/minecraft-bedrock";
import { MINECRAFT_JAVA } from "./definitions/minecraft-java";
import { PROJECT_ZOMBOID } from "./definitions/project-zomboid";
import { TERRARIA } from "./definitions/terraria";
import { VALHEIM } from "./definitions/valheim";
import type { GameDefinition, GameTemplate, GameVersion } from "./types";

/* The game registry.

   Adding a game is adding a definition and a line here. Nothing else in
   the platform should have to change, and if it does, the abstraction
   has a hole in it worth fixing rather than working around.

   The order is the order the catalog renders in.

   Parked, September 2026: Rust, Palworld and Satisfactory. Their
   definitions are kept (definitions/rust.ts, palworld.ts,
   satisfactory.ts), each with a note on what has to be measured before
   it comes back. None of the three has ever run from its own image —
   they need 12–16 GB each, and every game that *has* run for real
   turned out to have bugs a definition cannot show (a world landing
   outside the backed-up directory, settings that never reached the
   game). Offering a game nobody has booted is offering a guess. The
   catalog sync retires them, so a workspace that had them keeps its
   rows; re-enabling one is an import and a line below, after a real
   run on a machine with the memory. */

const DEFINITIONS: GameDefinition[] = [
  MINECRAFT_JAVA,
  MINECRAFT_BEDROCK,
  TERRARIA,
  PROJECT_ZOMBOID,
  // RUST — parked, see above
  VALHEIM,
  GARRYS_MOD,
  // PALWORLD — parked, see above
  // SATISFACTORY — parked, see above
];

/* The definitions that are kept and not offered, by id. A definition file is a game the registry offers or one named here: a file that is
   neither is a forgotten line, and test/extension-guards.test.ts fails on it, and audits both kinds. */
export const PARKED: readonly string[] = ["rust", "palworld", "satisfactory"];

const BY_ID = new Map(DEFINITIONS.map((game) => [game.id, game]));

/* A definition with two versions sharing an id, or a port layout with
   two primaries, is a mistake that would otherwise surface as a strange
   server hours later. Checked once, at module load, where the stack
   trace still points at the definition that is wrong. */
function audit() {
  const problems: string[] = [];

  for (const game of DEFINITIONS) problems.push(...auditDefinition(game));

  if (BY_ID.size !== DEFINITIONS.length) problems.push("two games share an id");
  if (problems.length > 0) {
    throw new Error(`game definitions are inconsistent:\n  ${problems.join("\n  ")}`);
  }
}

audit();

/* ── Games that came from a manifest ──────────────────────────────────
   The registry above is constant: the games Geeboard ships. A game an owner
   approved is not, and it has to be findable by the same synchronous calls
   — about forty files ask for a game by id — so it lives beside the constant
   ones and is put there by whoever knows how to read it (lib/community-games.ts).

   Two lists, because they answer two questions. `active` is what may be
   *created*: it is in allGames(), so in the wizard, the catalog sync and the
   API. `retired` is what servers already made from it still need in order to
   be run, shown and changed: findGame() finds it, allGames() does not list it.

   Kept on globalThis, like the database client: the development server
   reloads this module, and a list that went with it would leave the panel
   unable to find a game until the next poll. */
interface CommunityState {
  active: GameDefinition[];
  retired: GameDefinition[];
  byId: Map<string, GameDefinition>;
}

const COMMUNITY = Symbol.for("geeboard.community-games");
const shared = globalThis as unknown as { [COMMUNITY]?: CommunityState };

function community(): CommunityState {
  return (shared[COMMUNITY] ??= { active: [], retired: [], byId: new Map() });
}

/** The prefix every community game's id carries, and no game Geeboard ships does. */
export const COMMUNITY_PREFIX = "community-";

export function isCommunityId(id: string): boolean {
  return id.startsWith(COMMUNITY_PREFIX);
}

/** Replaces the games that came from a manifest. One that takes a shipped game's id, or has no prefix, is dropped: it cannot be told apart from it. */
export function setCommunityGames(games: { active: readonly GameDefinition[]; retired: readonly GameDefinition[] }): void {
  const usable = (game: GameDefinition) => isCommunityId(game.id) && !BY_ID.has(game.id);
  const active = games.active.filter(usable);
  const retired = games.retired.filter((g) => usable(g) && !active.some((a) => a.id === g.id));
  community().active = active;
  community().retired = retired;
  community().byId = new Map([...retired, ...active].map((g) => [g.id, g]));
}

/* Whether a new server may be made from this game: it is one Geeboard ships, or an approved community game that has
   not been retired. findGame() answers for a retired game too, because servers already made from it need it. */
export function isOffered(id: string): boolean {
  return BY_ID.has(id) || community().active.some((g) => g.id === id);
}

/** What is loaded, for a poll to tell whether anything changed. */
export function communityGameIds(): { active: string[]; retired: string[] } {
  return { active: community().active.map((g) => g.id), retired: community().retired.map((g) => g.id) };
}

/* ── Versions that came from a registry's tags ────────────────────────
   A game that names its image's repository (GameDefinition.followTags) is told
   about the releases newer than the definition by the registry, and each becomes
   a version beside the ones the definition ships — see followed.ts. They are put
   here by whoever lists the tags (lib/followed-versions.ts, in the poller and in
   the panel, which each have their own registry in memory) and, for the wizard,
   handed to the browser as data.

   The definitions above stay what they are. A game is asked for through
   findGame() and allGames(), which answer with its followed versions in; the
   merged definition is made once per list and kept, so asking again is the same
   object and a page does not rebuild it on every render.

   Kept on globalThis for the same reason as the community games. */
interface FollowedState {
  byGame: Map<string, GameVersion[]>;
  merged: WeakMap<GameDefinition, { source: GameVersion[]; game: GameDefinition }>;
}

const FOLLOWED = Symbol.for("geeboard.followed-versions");
const sharedFollowed = globalThis as unknown as { [FOLLOWED]?: FollowedState };

function followed(): FollowedState {
  return (sharedFollowed[FOLLOWED] ??= { byGame: new Map(), merged: new WeakMap() });
}

/* Replaces the followed versions of every game. A list is read through acceptFollowed(): an image from another repository, a version
   with the id of one the definition ships, or one of a game that follows nothing is dropped, wherever the list came from. */
export function setFollowedVersions(versions: Readonly<Record<string, readonly GameVersion[]>>): void {
  const byGame = new Map<string, GameVersion[]>();
  for (const [gameId, list] of Object.entries(versions)) {
    const game = BY_ID.get(gameId);
    const accepted = game && Array.isArray(list) ? acceptFollowed(game, list) : [];
    if (accepted.length > 0) byGame.set(gameId, accepted);
  }
  sharedFollowed[FOLLOWED] = { byGame, merged: new WeakMap() };
}

/** What is held, by game: for the page to hand to the browser. */
export function followedVersionsHeld(): Record<string, GameVersion[]> {
  return Object.fromEntries(followed().byGame);
}

/** A game Geeboard ships as its definition says it, without the versions found in a registry: what those are made from. */
export function shippedDefinition(id: string): GameDefinition | undefined {
  return BY_ID.get(id);
}

function withFollowedVersions(game: GameDefinition): GameDefinition {
  const source = followed().byGame.get(game.id);
  if (!source) return game;
  const kept = followed().merged.get(game);
  if (kept && kept.source === source) return kept.game;
  const merged = withFollowed(game, source);
  followed().merged.set(game, { source, game: merged });
  return merged;
}

/** Every game Geeboard can host, in catalog order: the ones it ships, then the ones an owner approved. */
export function allGames(): readonly GameDefinition[] {
  const extra = community().active;
  const shipped = followed().byGame.size === 0 ? DEFINITIONS : DEFINITIONS.map(withFollowedVersions);
  return extra.length === 0 ? shipped : [...shipped, ...extra];
}

export function findGame(id: string): GameDefinition | undefined {
  const shipped = BY_ID.get(id);
  return shipped ? withFollowedVersions(shipped) : community().byId.get(id);
}

/** Like findGame, but for callers that have no sensible "missing" path. */
export function requireGame(id: string): GameDefinition {
  const game = findGame(id);
  if (!game) {
    throw new PlatformError("GAME_NOT_FOUND", "Geeboard does not know that game.", {
      details: { gameId: id },
    });
  }
  return game;
}

/** A version by its id, or by an id it used to go by. */
export function findVersion(game: GameDefinition, id: string): GameVersion | undefined {
  return (
    game.versions.find((v) => v.id === id) ??
    game.versions.find((v) => v.formerIds?.includes(id))
  );
}

/* The version a server is on.

   The catalog link first, because it is an id and ids survive a relabel.
   The stored label is the fallback for a server that predates the link —
   and only a fallback: "Build 41 · stable" matched nothing the moment the
   version was renamed, and a caller that then guessed at a version would
   rebuild a build 41 world on build 42.

   Undefined when neither resolves. Callers must treat that as "cannot
   say", never substitute a version of their own. */
export function versionOfServer(
  game: GameDefinition,
  server: { versionSlug?: string | null; versionLabel: string },
): GameVersion | undefined {
  return (
    (server.versionSlug ? findVersion(game, server.versionSlug) : undefined) ??
    game.versions.find((v) => v.label === server.versionLabel)
  );
}

export function requireVersion(game: GameDefinition, id: string): GameVersion {
  const version = findVersion(game, id);
  if (!version) {
    throw new PlatformError("GAME_VERSION_NOT_FOUND", `${game.name} has no such version.`, {
      details: { gameId: game.id, versionId: id },
    });
  }
  if (version.supported === false) {
    throw new PlatformError(
      "GAME_VERSION_UNSUPPORTED",
      `Geeboard no longer installs ${version.label}.`,
      { details: { gameId: game.id, versionId: id } },
    );
  }
  return version;
}

export function findTemplate(game: GameDefinition, id: string): GameTemplate | undefined {
  return game.templates.find((t) => t.id === id);
}

/* The panel groups servers by family — "Minecraft" covers both editions
   — so a server row can find its way back to a definition through the
   name it was stored under. */
export function gamesInFamily(family: string): GameDefinition[] {
  return [...DEFINITIONS.map(withFollowedVersions), ...community().active, ...community().retired].filter((g) => g.family === family);
}
