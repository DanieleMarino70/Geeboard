import type { ConfigValues } from "../games/config";
import type { ConfigField, ConfigValue, GameDefinition } from "../games/types";

/* What a saved template is, and what it is not.

   A server has everything a template needs: its settings, its limits, its
   version. What makes a template different from a copy of a server is what it
   leaves behind, and each of these is decided here once so that every place
   that saves or applies one agrees:

     - a setting marked `secret` — a join password — is not carried. A
       template is read by anyone who may create a server, and a password
       written into it would sit in a row many accounts can see. The server a
       template makes asks for its own, as any new one does.
     - a setting that names a file in the server's own folder (Terraria's
       world file) is not carried: it points at a world on one server's disk,
       and a server made from the template has a folder of its own. The
       definition says which with `fromFiles`, the same field the Files page
       uses to offer "Use as world".
     - a setting this game does not have — a key from another version line, or
       from a definition since changed — is dropped when the template is
       applied, never passed on to a node.
     - what it was made from: the world, the players, the address, the port,
       the node, the schedule. A template is a way to start, not a backup.

   Pure: a definition and some values in, values out. The operations that read
   and write rows are lib/template-ops.ts. */

/** Whether a setting travels in a template: not a secret, and not a file in a server's own folder. */
export function travels(field: ConfigField): boolean {
  return field.secret !== true && field.fromFiles === undefined;
}

function fits(field: ConfigField, value: unknown): value is ConfigValue {
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
    case "string":
    case "text":
      return typeof value === "string";
  }
}

/** The settings of a server that a template keeps. `game` is already narrowed to the server's version line. */
export function settingsToKeep(game: Pick<GameDefinition, "config">, config: Record<string, unknown>): ConfigValues {
  const out: ConfigValues = {};
  for (const field of game.config) {
    if (!travels(field)) continue;
    const value = config[field.key];
    if (fits(field, value)) out[field.key] = value;
  }
  return out;
}

/**
 * The settings a template contributes to a new server, over the defaults. Only
 * keys the game has on the version line chosen, and only of the type each
 * expects: a template saved before a definition changed cannot put anything
 * into a create that the definition would not have.
 */
export function settingsToApply(game: Pick<GameDefinition, "config">, saved: unknown): ConfigValues {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return settingsToKeep(game, saved as Record<string, unknown>);
}

/**
 * The settings a clone keeps. A clone is a copy of a server that is going to
 * be given that server's world, so a setting that names a file in its folder
 * stays — the world file the restore puts back is the one it names. A secret
 * still does not: the new server asks for its own password.
 */
export function settingsToClone(game: Pick<GameDefinition, "config">, config: Record<string, unknown>): ConfigValues {
  const out: ConfigValues = {};
  for (const field of game.config) {
    if (field.secret === true) continue;
    const value = config[field.key];
    if (fits(field, value)) out[field.key] = value;
  }
  return out;
}

/** The settings that do not travel, by label, for saying so when a template is saved. */
export function leftBehind(game: Pick<GameDefinition, "config">): string[] {
  return game.config.filter((f) => !travels(f)).map((f) => f.label);
}

const NAME = { min: 2, max: 40 };

/** Null when the name is fine, a sentence when it is not. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < NAME.min) return `Give the template a name of at least ${NAME.min} characters.`;
  if (name.length > NAME.max) return `That name is too long; ${NAME.max} characters is enough.`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return "A name is text, without control characters.";
  return null;
}

/** One line for a list: how many settings, and the limits. */
export function summaryOf(template: { config: unknown; memoryGb: number; cpuLimit: number; diskGb: number }): string {
  const count = template.config && typeof template.config === "object" ? Object.keys(template.config as object).length : 0;
  return `${count} setting${count === 1 ? "" : "s"} · ${template.memoryGb} GB memory · ${template.cpuLimit}% CPU · ${template.diskGb} GB disk`;
}

/**
 * Which of the game's versions a template starts on: the one it was saved at
 * when the game still offers it, else the game's own default, and whether that
 * is a change the page has to say.
 */
export function startVersion(
  game: Pick<GameDefinition, "versions">,
  saved: { versionSlug: string | null; versionLabel: string | null },
  fallback: { id: string; label: string },
): { id: string; changed: boolean; was: string | null } {
  const found =
    (saved.versionSlug ? game.versions.find((v) => v.id === saved.versionSlug || v.formerIds?.includes(saved.versionSlug!)) : undefined) ??
    (saved.versionLabel ? game.versions.find((v) => v.label === saved.versionLabel) : undefined);
  if (found && found.supported !== false) return { id: found.id, changed: false, was: null };
  return { id: fallback.id, changed: true, was: saved.versionLabel ?? saved.versionSlug };
}
