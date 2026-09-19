import { PlatformError } from "../errors";
import { MINECRAFT_BEDROCK } from "./definitions/minecraft-bedrock";
import { MINECRAFT_JAVA } from "./definitions/minecraft-java";
import { PALWORLD } from "./definitions/palworld";
import { PROJECT_ZOMBOID } from "./definitions/project-zomboid";
import { RUST } from "./definitions/rust";
import { SATISFACTORY } from "./definitions/satisfactory";
import { TERRARIA } from "./definitions/terraria";
import { VALHEIM } from "./definitions/valheim";
import type { GameDefinition, GameTemplate, GameVersion } from "./types";

/* The game registry.

   Adding a game is adding a definition and a line here. Nothing else in
   the platform should have to change, and if it does, the abstraction
   has a hole in it worth fixing rather than working around.

   The order is the order the catalog renders in. */

const DEFINITIONS: GameDefinition[] = [
  MINECRAFT_JAVA,
  MINECRAFT_BEDROCK,
  TERRARIA,
  PROJECT_ZOMBOID,
  RUST,
  VALHEIM,
  PALWORLD,
  SATISFACTORY,
];

const BY_ID = new Map(DEFINITIONS.map((game) => [game.id, game]));

/* A definition with two versions sharing an id, or a port layout with
   two primaries, is a mistake that would otherwise surface as a strange
   server hours later. Checked once, at module load, where the stack
   trace still points at the definition that is wrong. */
function audit() {
  const problems: string[] = [];

  for (const game of DEFINITIONS) {
    const versions = new Set<string>();
    for (const version of game.versions) {
      if (versions.has(version.id)) problems.push(`${game.id}: duplicate version ${version.id}`);
      versions.add(version.id);
    }
    /* A former id that is also a live id, or that two versions both
       claim, would make a lookup by it answer with whichever came first. */
    const former = new Set<string>();
    for (const version of game.versions) {
      for (const id of version.formerIds ?? []) {
        if (versions.has(id)) problems.push(`${game.id}: former id ${id} is still a version id`);
        if (former.has(id)) problems.push(`${game.id}: two versions claim former id ${id}`);
        former.add(id);
      }
    }
    if (game.versions.length === 0) problems.push(`${game.id}: no versions`);

    const primaries = game.ports.filter((p) => p.primary).length;
    if (primaries !== 1) problems.push(`${game.id}: ${primaries} primary ports, expected exactly 1`);

    const offsets = new Set(game.ports.map((p) => p.offset));
    if (offsets.size !== game.ports.length) problems.push(`${game.id}: two ports share an offset`);

    const keys = new Set(game.config.map((f) => f.key));
    if (keys.size !== game.config.length) problems.push(`${game.id}: two config fields share a key`);

    for (const template of game.templates) {
      for (const key of Object.keys(template.config)) {
        if (!keys.has(key)) problems.push(`${game.id}/${template.id}: unknown config key ${key}`);
      }
    }

    const { memoryGb, cpuLimit, diskGb } = game.limits;
    if (game.defaults.memoryGb < memoryGb[0] || game.defaults.memoryGb > memoryGb[1]) {
      problems.push(`${game.id}: default memory is outside its own limits`);
    }
    if (game.defaults.cpuLimit < cpuLimit[0] || game.defaults.cpuLimit > cpuLimit[1]) {
      problems.push(`${game.id}: default CPU is outside its own limits`);
    }
    if (game.defaults.diskGb < diskGb[0] || game.defaults.diskGb > diskGb[1]) {
      problems.push(`${game.id}: default disk is outside its own limits`);
    }
    if (game.requirements.memoryGbMin > memoryGb[1]) {
      problems.push(`${game.id}: requires more memory than its own ceiling allows`);
    }

    /* A player pattern that does not compile, or has no name to read,
       would fail silently in the poller on every pass. */
    for (const [which, pattern] of Object.entries(game.console.players ?? {})) {
      try {
        if (!pattern.includes("(?<name>")) problems.push(`${game.id}: player ${which} pattern has no name group`);
        new RegExp(pattern);
      } catch {
        problems.push(`${game.id}: player ${which} pattern does not compile`);
      }
    }

    /* A port the resource environment names that the game does not have
       would simply never be set — and the second server on a node would
       send its players to the first one's port. */
    for (const role of Object.keys(game.resourceEnv?.ports ?? {})) {
      if (!game.ports.some((p) => p.id === role)) problems.push(`${game.id}: resourceEnv names a port "${role}" it does not have`);
    }
    // A resume with nothing paused before it is a command sent for no reason.
    if (game.console.resumeCommand && !game.console.saveCommand) {
      problems.push(`${game.id}: resumeCommand without a saveCommand to undo`);
    }
    // The prefix is what the console redaction matches on.
    for (const [name, prefix] of Object.entries(game.resourceEnv?.secrets ?? {})) {
      if (!/^[a-z][a-z0-9]{2,15}$/.test(prefix)) problems.push(`${game.id}: secret ${name} needs a short lowercase prefix`);
    }
    for (const field of game.config) {
      for (const other of [field.requiredWhen?.key, field.mustNotContain]) {
        if (other && !game.config.some((f) => f.key === other)) {
          problems.push(`${game.id}: ${field.key} refers to a setting "${other}" it does not have`);
        }
      }
    }
  }

  if (BY_ID.size !== DEFINITIONS.length) problems.push("two games share an id");
  if (problems.length > 0) {
    throw new Error(`game definitions are inconsistent:\n  ${problems.join("\n  ")}`);
  }
}

audit();

/** Every game Geeboard can host, in catalog order. */
export function allGames(): readonly GameDefinition[] {
  return DEFINITIONS;
}

export function findGame(id: string): GameDefinition | undefined {
  return BY_ID.get(id);
}

/** Like findGame, but for callers that have no sensible "missing" path. */
export function requireGame(id: string): GameDefinition {
  const game = BY_ID.get(id);
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
  return DEFINITIONS.filter((g) => g.family === family);
}
