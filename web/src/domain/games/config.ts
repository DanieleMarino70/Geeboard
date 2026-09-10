import { PlatformError } from "../errors";
import type { ConfigField, ConfigValue, GameDefinition, GameVersion } from "./types";

/* Game-aware configuration.

   A setting has two lives. In the panel it is "Max players", a number
   with a floor and a ceiling. On the node it is an environment variable,
   or a line in serverconfig.txt, or a key under an INI section. This
   module is where one becomes the other, so that nothing above it has to
   know which game it is holding and nothing below it has to know what a
   setting means.

   Rendering produces patches, never whole files. A game writes to its
   own config as it runs — a world seed it chose, a setting an admin
   changed in-game — and regenerating the file from the panel's idea of
   it would quietly throw that away. */

export type ConfigValues = Record<string, ConfigValue>;

/** Every field at its default. The starting point for a new server. */
export function defaultsFor(game: GameDefinition): ConfigValues {
  const out: ConfigValues = {};
  for (const field of game.config) out[field.key] = field.default;
  return out;
}

/** Defaults with a template applied over them. */
export function applyTemplate(game: GameDefinition, templateId: string | null): ConfigValues {
  const values = defaultsFor(game);
  if (!templateId) return values;

  const template = game.templates.find((t) => t.id === templateId);
  if (!template) return values;

  for (const [key, value] of Object.entries(template.config)) {
    // audit() in the registry has already rejected unknown keys, so
    // anything here is a field this game really has.
    values[key] = value;
  }
  return values;
}

/* ── Validation ───────────────────────────────────────────────────
   Returns every problem rather than the first, so a form can mark all
   of its bad fields in one pass. */

export interface FieldProblem {
  key: string;
  label: string;
  message: string;
}

function checkField(field: ConfigField, raw: unknown): FieldProblem | null {
  const fail = (message: string): FieldProblem => ({ key: field.key, label: field.label, message });

  switch (field.type) {
    case "boolean":
      if (typeof raw !== "boolean") return fail("must be true or false");
      return null;

    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return fail("must be a number");
      if (!Number.isInteger(raw)) return fail("must be a whole number");
      if (field.min !== undefined && raw < field.min) return fail(`must be at least ${field.min}`);
      if (field.max !== undefined && raw > field.max) return fail(`must be at most ${field.max}`);
      return null;
    }

    case "enum": {
      if (typeof raw !== "string") return fail("must be one of the listed options");
      const allowed = field.options?.map((o) => o.value) ?? [];
      if (!allowed.includes(raw)) return fail(`must be one of: ${allowed.join(", ")}`);
      return null;
    }

    case "string":
    case "text": {
      if (typeof raw !== "string") return fail("must be text");
      const max = field.maxLength ?? (field.type === "text" ? 2000 : 200);
      if (raw.length > max) return fail(`must be ${max} characters or fewer`);
      /* A newline in a value destined for a key=value file would be read
         back as the start of another setting. Text fields are allowed
         them; single-line fields are not. */
      if (field.type === "string" && /[\r\n]/.test(raw)) return fail("must be a single line");
      if (raw.includes("\0")) return fail("cannot contain a null byte");
      return null;
    }
  }
}

export function validateConfig(game: GameDefinition, values: ConfigValues): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const known = new Set(game.config.map((f) => f.key));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      problems.push({ key, label: key, message: `${game.name} has no setting called ${key}` });
    }
  }

  for (const field of game.config) {
    // A value left out keeps its default, which is always valid.
    if (!(field.key in values)) continue;
    const problem = checkField(field, values[field.key]);
    if (problem) problems.push(problem);
  }

  return problems;
}

/** Throws the first problem as a PlatformError, for callers with no form to mark up. */
export function assertValidConfig(game: GameDefinition, values: ConfigValues): void {
  const problems = validateConfig(game, values);
  const first = problems[0];
  if (!first) return;
  throw new PlatformError("VALIDATION_FAILED", `${first.label} ${first.message}.`, {
    details: { gameId: game.id, problems },
  });
}

/** Which changed settings only take effect on the next boot. */
export function restartRequiredFor(
  game: GameDefinition,
  before: ConfigValues,
  after: ConfigValues,
): string[] {
  return game.config
    .filter((f) => f.restartRequired && f.key in after && before[f.key] !== after[f.key])
    .map((f) => f.label);
}

/* ── Rendering ────────────────────────────────────────────────────── */

/** A set of keys to merge into one config file, leaving the rest alone. */
export interface ConfigFilePatch {
  path: string;
  format: "properties" | "ini" | "json";
  /** For INI, keyed by section; properties and JSON use the empty section. */
  entries: Array<{ section: string; key: string; value: string }>;
}

export interface RenderedConfig {
  /** Environment variables for the runtime. Applied at creation. */
  env: Record<string, string>;
  /** Files that need patching on the node before the server starts. */
  files: ConfigFilePatch[];
  /** Command-line flags the runtime should pass through. */
  args: string[];
}

function asText(value: ConfigValue): string {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

/* Turns a game's settings into the shape each of its targets needs.

   The environment half is applied today. The file patches are returned
   but not yet written — that lands with the installer in Phase 4, and
   producing them now is what lets a definition describe a game honestly
   instead of pretending everything is an environment variable. */
export function renderConfig(
  game: GameDefinition,
  values: ConfigValues,
  version?: GameVersion | { env?: Record<string, string> },
): RenderedConfig {
  const env: Record<string, string> = {};
  const patches = new Map<string, ConfigFilePatch>();
  const args: string[] = [];

  // Install first, then version, then settings: a setting the operator
  // chose should win over a default the image ships with.
  if (game.install.kind === "image" && game.install.env) Object.assign(env, game.install.env);
  if (version?.env) Object.assign(env, version.env);

  for (const field of game.config) {
    const value = field.key in values ? values[field.key]! : field.default;
    const text = asText(value);

    switch (field.target.kind) {
      case "env":
        env[field.target.name] = text;
        break;

      case "arg":
        // A flag with an empty value is left off entirely.
        if (text.length > 0) args.push(field.target.flag, text);
        break;

      case "properties":
      case "ini":
      case "json": {
        const path = field.target.file;
        const format = field.target.kind === "json" ? "json" : field.target.kind;
        const patch = patches.get(path) ?? { path, format, entries: [] };
        patch.entries.push({
          section: field.target.kind === "ini" ? field.target.section : "",
          key: field.target.kind === "json" ? field.target.pointer : field.target.key,
          value: text,
        });
        patches.set(path, patch);
        break;
      }
    }
  }

  return { env, files: [...patches.values()], args };
}

/* ── Reading a patch back out ─────────────────────────────────────
   Merging into an existing file rather than replacing it. Kept here
   beside the rendering so the two halves cannot drift apart. */

/** Merges properties-style `key=value` lines, preserving order and comments. */
export function mergeProperties(existing: string, entries: Array<{ key: string; value: string }>): string {
  const wanted = new Map(entries.map((e) => [e.key, e.value]));
  const seen = new Set<string>();

  const lines = existing.split(/\r?\n/).map((line) => {
    const match = /^(\s*)([A-Za-z0-9_.\-]+)(\s*=\s*)(.*)$/.exec(line);
    if (!match) return line; // a comment, a blank, or something we do not understand
    const [, indent, key, separator] = match;
    if (!wanted.has(key!)) return line;
    seen.add(key!);
    return `${indent}${key}${separator}${wanted.get(key!)}`;
  });

  // Anything the file did not already have goes on the end.
  for (const [key, value] of wanted) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }

  const out = lines.join("\n");
  return out.endsWith("\n") ? out : `${out}\n`;
}
