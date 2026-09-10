/* The catalog, as the browser sees it.

   This used to be where games were defined. They now live in
   src/domain/games, and this file is the projection the wizard renders
   from — a stable, client-safe surface over the registry, so the
   creation flow did not have to be rewritten when the definitions moved.

   Deliberately not "server-only": the wizard renders these in the
   browser and the create operation validates against the same registry,
   so there is one source of truth and no way for the two to disagree.
   Nothing in a game definition is a secret. */

export type {
  GameDefinition as Game,
  GameTemplate as Template,
  GameVersion as Version,
  PortRole,
  Protocol,
} from "@/domain/games/types";

export { portsFor, primaryPort, protocolLabel, strideOf } from "@/domain/games/types";

import { allGames, findGame, findTemplate, findVersion } from "@/domain/games/registry";
import type { GameDefinition, GameTemplate, GameVersion } from "@/domain/games/types";

/** Every game Geeboard can host, in catalog order. */
export const GAMES: readonly GameDefinition[] = allGames();

export function gameById(id: string): GameDefinition | undefined {
  return findGame(id);
}

export function versionById(game: GameDefinition, id: string): GameVersion | undefined {
  return findVersion(game, id);
}

export function templateById(game: GameDefinition, id: string): GameTemplate | undefined {
  return findTemplate(game, id);
}

/* Definitions carry ISO dates so they sort; people read them the other
   way round. A date that is not ISO is passed through, since some
   versions predate anything a provider could tell us. */
export function formatReleased(released: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(released) ? new Date(`${released}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return released;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A server name turned into the slug that becomes its URL and hostname. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // NFKD split the accents off; this drops the combining marks.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38);
}
