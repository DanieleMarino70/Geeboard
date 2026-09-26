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

/* The settings a version actually has.

   A field that names version lines exists only on them; one that names
   none exists everywhere. With no line to go on — a server whose
   version no longer resolves — the per-line fields are left out rather
   than guessed at, since a select showing build 42's values to a build
   41 world would be a setting with the wrong meaning. */
export function configFor(game: GameDefinition, line: string | undefined): ConfigField[] {
  return game.config.filter((field) => !field.lines || (line !== undefined && field.lines.includes(line)));
}

/* The same game, narrowed to one version line. Everything in this module
   takes a definition and reads `config` off it, so callers that know
   the version — the wizard, the settings page, an install — narrow once
   at the boundary and nothing below has to learn about lines. */
export function scopeToLine(game: GameDefinition, line: string | undefined): GameDefinition {
  return { ...game, config: configFor(game, line) };
}

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
      if (field.pattern && raw.length > 0 && !new RegExp(field.pattern.regex).test(raw)) return fail(field.pattern.message);
      /* An empty value is "not set", which is a different question from
         "long enough" — whether it may be empty at all is decided by
         requiredWhen, beside the field that decides it. */
      if (field.minLength !== undefined && raw.length > 0 && raw.length < field.minLength) {
        return fail(`must be at least ${field.minLength} characters`);
      }
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

  /* Rules that read two settings at once. Checked over the whole set the
     server would end up with — a field's own default where the caller
     did not send one — because "the password may not be empty when the
     server is public" is about the result, not about what was typed. */
  const settled = { ...defaultsFor(game), ...values };
  for (const field of game.config) {
    const value = settled[field.key];

    if (field.requiredWhen && settled[field.requiredWhen.key] === field.requiredWhen.equals && value === "") {
      const other = game.config.find((f) => f.key === field.requiredWhen!.key);
      problems.push({
        key: field.key,
        label: field.label,
        message: `is needed when ${(other?.label ?? field.requiredWhen.key).toLowerCase()} is on`,
      });
    }

    if (field.mustNotContain && typeof value === "string" && value.length > 0) {
      const other = game.config.find((f) => f.key === field.mustNotContain);
      const forbidden = settled[field.mustNotContain];
      if (typeof forbidden === "string" && forbidden.length > 0 && value.toLowerCase().includes(forbidden.toLowerCase())) {
        problems.push({
          key: field.key,
          label: field.label,
          message: `must not contain the ${(other?.label ?? field.mustNotContain).toLowerCase()}`,
        });
      }
    }
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

/* ── What a change would cost ─────────────────────────────────────
   Not every setting can be changed the same way, and the difference is
   not a detail an operator can be left to discover.

   A value that lives in a config file can be written to a running
   server and picked up at its next restart. A value that is an
   environment variable cannot: the environment is fixed when the
   workload is created, so changing one means building a new workload
   around the same world.

   Both are honest answers. Quietly saving an environment change and
   leaving the server running the old value is not. */

export interface ConfigChange {
  key: string;
  label: string;
  from: ConfigValue;
  to: ConfigValue;
  /** How this change reaches the server. */
  applies: "immediately" | "on-restart" | "on-recreate";
}

export interface ConfigPlan {
  changes: ConfigChange[];
  /** At least one change needs the workload rebuilt. */
  needsRecreate: boolean;
  /** A restart is enough for at least one change. */
  needsRestart: boolean;
}

/** The settings a server currently has, over the game's defaults. */
export function currentConfig(
  game: GameDefinition,
  server: { config?: unknown },
): ConfigValues {
  const stored = (server.config ?? {}) as ConfigValues;
  return { ...defaultsFor(game), ...stored };
}

export function planConfigChange(
  game: GameDefinition,
  before: ConfigValues,
  after: ConfigValues,
): ConfigPlan {
  const restartLabels = new Set(restartRequiredFor(game, before, after));
  const changes: ConfigChange[] = [];

  for (const field of game.config) {
    if (!(field.key in after)) continue;
    const from = before[field.key] ?? field.default;
    const to = after[field.key]!;
    if (from === to) continue;

    const applies =
      field.target.kind === "env" || field.target.kind === "arg"
        ? ("on-recreate" as const)
        : restartLabels.has(field.label)
          ? ("on-restart" as const)
          : ("immediately" as const);

    changes.push({ key: field.key, label: field.label, from, to, applies });
  }

  return {
    changes,
    needsRecreate: changes.some((c) => c.applies === "on-recreate"),
    needsRestart: changes.some((c) => c.applies === "on-restart"),
  };
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
  format: "properties" | "ini" | "json" | "lua";
  /* For INI, keyed by section; properties and JSON use the empty
     section. For Lua the section is the table and the key a dotted path
     inside it; an empty key is the table's base, the module the file
     `require`s before any key is set. */
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

/* A value as a Lua literal. Numbers and booleans are bare. A string
   that reads as a number is written bare too — an enum whose options
   are "0.65" and "1.2" is a number the form happens to carry as text,
   and Zomboid's `PopulationMultiplier = "0.65"` would be a string where
   the game wants a float. Anything else is a quoted Lua string. */
function asLua(value: ConfigValue): string {
  if (typeof value === "boolean" || typeof value === "number") return asText(value);
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/* Turns a game's settings into the shape each of its targets needs.

   Environment variables go to the runtime at provisioning; file patches
   are written to the node by the installer before the server's first
   start. Both halves come from the same render, so a game configured by
   file and one configured by variable are the same amount of work to
   describe — which is what keeps a definition honest. */
export interface RenderOptions {
  /* Write settings whose value is empty.

     Off by default, and that default is load-bearing. An empty seed,
     password or description means "not set", and writing `seed=` into a
     config file the game has already chosen a seed in would erase it —
     the exact data loss merging rather than replacing exists to prevent.

     The settings-update path turns this on for fields an operator
     actually changed, because clearing a password has to be possible. */
  includeEmpty?: boolean;
  /* This render is for a server being made. A `fixedAfterCreation`
     field is rendered only then: its file is the world's rules from the
     first start on, and the game rewrites it and an operator edits it
     by hand, so writing the panel's copy back on a later save or rebuild
     would put creation-day values over what the world has now. Off, such
     fields render nothing at all. */
  creating?: boolean;
  /* The mods this server has, for a game that takes them. Two lists,
     because they answer different questions: what to download, and what
     to load — see ModSupport. Absent leaves both keys alone; an empty
     list writes both as empty, which is how the last mod is removed. */
  mods?: { items: string[]; enabled: string[] };
}

export function renderConfig(
  game: GameDefinition,
  values: ConfigValues,
  version?: GameVersion | { env?: Record<string, string>; args?: string[] },
  options: RenderOptions = {},
): RenderedConfig {
  const env: Record<string, string> = {};
  const patches = new Map<string, ConfigFilePatch>();
  /* The version's own arguments first, then any setting's. They used to
     be rendered and then dropped: no provision plan carried them, so a
     setting targeting a flag reached nothing, and no definition could say
     how its server has to start. */
  const args: string[] = [...(version?.args ?? [])];

  // Install first, then version, then settings: a setting the operator
  // chose should win over a default the image ships with.
  if (game.install.kind !== "download" && game.install.env) Object.assign(env, game.install.env);
  if (version?.env) Object.assign(env, version.env);

  // The same order for files: what the image needs goes in first, so a
  // setting written below it with the same key is the one that lands.
  if (game.install.kind === "image") {
    for (const fixed of game.install.files ?? []) {
      const patch = patches.get(fixed.file) ?? { path: fixed.file, format: "properties", entries: [] };
      for (const [key, value] of Object.entries(fixed.entries)) {
        patch.entries.push({ section: "", key, value });
      }
      patches.set(fixed.file, patch);
    }
  }

  for (const field of game.config) {
    // See RenderOptions.creating: the world's rules are written once.
    if (field.fixedAfterCreation && !options.creating) continue;

    const value = field.key in values ? values[field.key]! : field.default;
    const text = asText(value);

    // See RenderOptions: an empty value is an absent one unless asked
    // for. A false boolean and a zero are values, and are not empty.
    if (text.length === 0 && !options.includeEmpty) continue;

    switch (field.target.kind) {
      case "env":
        env[field.target.name] = text;
        break;

      case "arg":
        args.push(field.target.flag, text);
        break;

      case "lua":
      case "lua-base": {
        const target = field.target;
        const patch = patches.get(target.file) ?? { path: target.file, format: "lua", entries: [] };
        if (target.kind === "lua-base") {
          patch.entries.push({ section: target.table, key: "", value: `${target.prefix}${text}` });
        } else {
          patch.entries.push({ section: target.table, key: target.key, value: asLua(value) });
          for (const extra of target.also ?? []) {
            const literal = extra.byValue ? extra.byValue[text] : extra.value;
            /* A companion with no value for this choice is a definition
               error, and one that would surface as a half-applied setting
               on a server hours later — so it stops the render instead. */
            if (literal === undefined) {
              throw new PlatformError("VALIDATION_FAILED", `${field.label} has no companion value for ${text}.`, {
                details: { gameId: game.id, key: field.key, also: extra.key },
              });
            }
            patch.entries.push({ section: target.table, key: extra.key, value: literal });
          }
        }
        patches.set(target.file, patch);
        break;
      }

      case "properties":
      case "ini":
      case "json": {
        const path = field.target.file;
        const format = field.target.kind === "json" ? "json" : field.target.kind;
        const patch = patches.get(path) ?? { path, format, entries: [] };
        patch.entries.push({
          section: field.target.kind === "ini" ? field.target.section : "",
          key: field.target.kind === "json" ? field.target.pointer : field.target.key,
          value: field.target.kind === "properties" && field.target.prefix ? `${field.target.prefix}${text}` : text,
        });
        patches.set(path, patch);
        break;
      }
    }
  }

  /* The mods, last, so they win over anything a setting wrote into the
     same keys. Both lists are written together or not at all: a server
     whose downloads are listed and whose mods are not loads nothing, and
     one whose mods are listed without their downloads logs each as "not
     found" and starts without it — measured on 41.78.19 and 42.20.4 —
     which is a server that looks fine and is not what was asked for. */
  if (game.mods && options.mods) {
    for (const [target, values] of [
      [game.mods.items, options.mods.items],
      [game.mods.enabled, options.mods.enabled],
    ] as const) {
      const patch = patches.get(target.file) ?? { path: target.file, format: "properties", entries: [] };
      patch.entries.push({ section: "", key: target.key, value: values.join(target.separator) });
      patches.set(target.file, patch);
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

/* Merges keys into an INI file, section by section.

   A section that is not there is appended with its keys; a key that is
   not there is appended inside its section. Anything the file already
   had — comments, ordering, keys the panel has never heard of — is left
   exactly where it was, because the game writes to this file too.

   The section bookkeeping is the part worth care. A key has to be
   written before the next section header, not at the end of the file: an
   INI key that lands after a different header belongs to that other
   section, which is a setting silently applied to the wrong thing. */
export function mergeIni(
  existing: string,
  entries: Array<{ section: string; key: string; value: string }>,
): string {
  const wanted = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    const section = wanted.get(entry.section) ?? new Map<string, string>();
    section.set(entry.key, entry.value);
    wanted.set(entry.section, section);
  }

  const out: string[] = [];
  const written = new Map<string, Set<string>>();
  let current = "";

  const flush = (section: string) => {
    const keys = wanted.get(section);
    if (!keys) return;
    const already = written.get(section) ?? new Set<string>();
    for (const [key, value] of keys) {
      if (!already.has(key)) {
        out.push(`${key}=${value}`);
        already.add(key);
      }
    }
    written.set(section, already);
  };

  for (const line of existing.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      flush(current);
      current = header[1]!;
      out.push(line);
      continue;
    }

    const pair = /^(\s*)([^=;#\s][^=]*?)(\s*=\s*)(.*)$/.exec(line);
    const key = pair?.[2];
    const replacement = key === undefined ? undefined : wanted.get(current)?.get(key);

    if (pair && replacement !== undefined) {
      out.push(`${pair[1]}${key}${pair[3]}${replacement}`);
      const already = written.get(current) ?? new Set<string>();
      already.add(key!);
      written.set(current, already);
    } else {
      out.push(line);
    }
  }
  flush(current);

  // Sections the file did not have at all.
  for (const [section, keys] of wanted) {
    if (written.has(section)) continue;
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(`[${section}]`);
    for (const [key, value] of keys) out.push(`${key}=${value}`);
  }

  const text = out.join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/* ── A Lua table the game reads as a file ─────────────────────────

   Zomboid's world rules are a Lua file, and it has two shapes.

   The one Geeboard writes, for a server that has never started:

       SandboxVars = require "Sandbox/Apocalypse"
       SandboxVars.Zombies = 5
       SandboxVars.ZombieConfig.PopulationMultiplier = 0.15

   The game's own preset by `require`, from inside the image, so the
   preset is never copied into this repository — then the operator's
   choices over it. Measured on both builds, 42.20.4 and 41.78.19: the
   server runs this, keeps every value, and then rewrites the file in
   the second shape — one nested table, every option, each with the
   game's own comment — which it reads again on every start:

       SandboxVars = {
           VERSION = 6,
           Zombies = 5,
           ZombieConfig = {
               PopulationMultiplier = 0.15,
           },
       }

   Writing into the second shape replaces `Key = value,` lines inside
   the table they belong to. A table or key the file does not have is
   an error, not an insertion: the game writes every option it knows,
   so a missing one means a build that does not have it, and appending
   it would be a guess about a file the game will read. */

const LUA_BASE = /^(\s*)([A-Za-z_]\w*)\s*=\s*require\s*\(?\s*"([^"]*)"\s*\)?\s*$/;
const LUA_OPEN = /^(\s*)([A-Za-z_]\w*)\s*=\s*\{\s*$/;
const LUA_CLOSE = /^\s*\},?\s*$/;
const LUA_PAIR = /^(\s*)([A-Za-z_]\w*)(\s*=\s*)(.*?)(,?)\s*$/;
const LUA_DOTTED = /^(\s*)([A-Za-z_][\w.]*)(\s*=\s*)(.*?)\s*$/;

function luaFailure(message: string, file?: string): PlatformError {
  return new PlatformError("SERVER_INSTALLATION_FAILED", message, {
    details: { step: "configure", file },
  });
}

/** Merges Lua assignments into whichever shape the file has, or makes the file. */
export function mergeLua(
  existing: string,
  entries: Array<{ section: string; key: string; value: string }>,
  file?: string,
): string {
  const tables = new Set(entries.map((e) => e.section));
  if (tables.size !== 1) throw luaFailure("A Lua patch writes one table at a time.", file);
  const table = entries[0]!.section;
  const base = entries.find((e) => e.key === "")?.value;
  const wanted = new Map(entries.filter((e) => e.key !== "").map((e) => [e.key, e.value]));

  const lines = existing.split(/\r?\n/);
  const nonBlank = lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith("--"));

  /* Nothing there: the file is made, and made from a base. Assignments
     into a table that does not exist would be a runtime error in the
     game, and a guessed `{}` would be a world with no rules at all. */
  if (nonBlank.length === 0) {
    if (base === undefined) throw luaFailure(`${table} has nothing to start from.`, file);
    const out = [
      `-- Written by Geeboard when this server was created: the game's own`,
      `-- preset, then the choices made in the panel. The game reads this file`,
      `-- on every start and rewrites it in full after the first one. Edit it`,
      `-- with the server stopped.`,
      `${table} = require "${base}"`,
    ];
    for (const [key, value] of wanted) out.push(`${table}.${key} = ${value}`);
    return `${out.join("\n")}\n`;
  }

  // The shape Geeboard wrote: a base line and dotted assignments.
  const baseAt = lines.findIndex((l) => LUA_BASE.test(l));
  if (baseAt >= 0) {
    const seen = new Set<string>();
    const out = lines.map((line) => {
      const asBase = LUA_BASE.exec(line);
      if (asBase && asBase[2] === table) {
        return base === undefined ? line : `${asBase[1]}${table} = require "${base}"`;
      }
      const dotted = LUA_DOTTED.exec(line);
      if (!dotted) return line;
      const prefix = `${table}.`;
      if (!dotted[2]!.startsWith(prefix)) return line;
      const key = dotted[2]!.slice(prefix.length);
      if (!wanted.has(key)) return line;
      seen.add(key);
      return `${dotted[1]}${table}.${key}${dotted[3]}${wanted.get(key)}`;
    });
    // Added keys go after the last assignment, not after the file's final newline.
    while (out.length > 0 && out[out.length - 1]!.trim().length === 0) out.pop();
    for (const [key, value] of wanted) if (!seen.has(key)) out.push(`${table}.${key} = ${value}`);
    return `${out.join("\n")}\n`;
  }

  // The shape the game writes: one nested table.
  if (!lines.some((l) => LUA_OPEN.exec(l)?.[2] === table)) {
    throw luaFailure(`${file ?? "The file"} holds no ${table} table Geeboard understands.`, file);
  }
  if (base !== undefined) {
    throw luaFailure(`${table} has already been written by the game; its preset cannot be changed now.`, file);
  }

  const path: string[] = [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const open = LUA_OPEN.exec(line);
    if (open) {
      path.push(open[2]!);
      return line;
    }
    if (LUA_CLOSE.test(line)) {
      path.pop();
      return line;
    }
    if (path[0] !== table) return line;
    const pair = LUA_PAIR.exec(line);
    if (!pair) return line;
    const key = [...path.slice(1), pair[2]!].join(".");
    if (!wanted.has(key)) return line;
    seen.add(key);
    return `${pair[1]}${pair[2]}${pair[3]}${wanted.get(key)}${pair[5]}`;
  });

  const missing = [...wanted.keys()].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw luaFailure(`${file ?? "The file"} has no ${table}.${missing[0]} for Geeboard to set.`, file);
  }

  const text = out.join("\n");
  return text.endsWith("\n") ? text : `${text}\n`;
}

/* The literal a Lua file holds for one key — the base module when the
   key is empty — from either shape, or undefined when it is not there.
   Strings come back unquoted; numbers and booleans as they are written. */
export function readLuaValue(content: string, table: string, key: string): string | undefined {
  const lines = content.split(/\r?\n/);

  if (key === "") {
    for (const line of lines) {
      const asBase = LUA_BASE.exec(line);
      if (asBase && asBase[2] === table) return asBase[3];
    }
    return undefined;
  }

  let found: string | undefined;
  const path: string[] = [];
  for (const line of lines) {
    const dotted = LUA_DOTTED.exec(line);
    if (dotted && dotted[2] === `${table}.${key}`) {
      found = dotted[4];
      continue;
    }
    const open = LUA_OPEN.exec(line);
    if (open) {
      path.push(open[2]!);
      continue;
    }
    if (LUA_CLOSE.test(line)) {
      path.pop();
      continue;
    }
    if (path[0] !== table) continue;
    const pair = LUA_PAIR.exec(line);
    if (pair && [...path.slice(1), pair[2]!].join(".") === key) found = pair[4];
  }

  if (found === undefined) return undefined;
  const quoted = /^"(.*)"$/.exec(found.trim());
  return quoted ? quoted[1]!.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : found.trim();
}

/* ── Reading a file back into settings ────────────────────────────

   The panel's stored settings are what it last wrote. They are not what
   the server has: somebody can edit `serverconfig.txt` from the Files
   page, and several games rewrite their own config on every start. The
   settings form used to show the stored values regardless, so an edit
   made on the node was invisible, and the next save silently put the
   panel's older value back.

   So the form reads the files too. Only file-backed fields can be read:
   an environment variable belongs to the workload, not to a file, and
   there is nothing on disk to look at. */

export interface ConfigFileContents {
  path: string;
  content: string;
}

/** Which files a game's settings live in — what to read before showing the form. */
export function configFilesOf(game: GameDefinition): string[] {
  const paths = new Set<string>();
  for (const field of game.config) {
    const kind = field.target.kind;
    if (kind === "properties" || kind === "ini" || kind === "lua" || kind === "lua-base") {
      paths.add(field.target.file);
    }
  }
  return [...paths];
}

const KEY_LINE = /^(\s*)([A-Za-z0-9_.\-]+)(\s*=\s*)(.*)$/;

/** The last assignment of `key` in a properties file, as the games themselves read it. */
function readProperty(content: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const match = KEY_LINE.exec(line);
    if (match && match[2] === key) found = match[4]!.trim();
  }
  return found;
}

/** The last assignment of `key` inside `[section]`; an empty section is the file's preamble. */
function readIniValue(content: string, section: string, key: string): string | undefined {
  let current = "";
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      current = header[1]!;
      continue;
    }
    if (current !== section) continue;
    const pair = /^(\s*)([^=;#\s][^=]*?)(\s*=\s*)(.*)$/.exec(line);
    if (pair && pair[2] === key) found = pair[4]!.trim();
  }
  return found;
}

/* A file holds text; a field has a type. A value the field cannot hold —
   a word where a number belongs, an enum option the definition does not
   list — is left out rather than forced, because a select cannot show a
   value that is not one of its options and a silent coercion would be
   another way of not saying what the server has. */
function asValue(field: ConfigField, raw: string): ConfigValue | undefined {
  switch (field.type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean":
      if (/^(true|1|yes|on)$/i.test(raw)) return true;
      if (/^(false|0|no|off)$/i.test(raw)) return false;
      return undefined;
    case "enum": {
      const exact = field.options?.find((o) => o.value === raw);
      if (exact) return exact.value;
      /* A numeric option and a numeric file value that are the same
         number are the same choice however they are spelled — a Lua
         file holds `2.0` where the option says "2", or `2` where it says
         "2.0" — and a select can show that. */
      const n = Number(raw);
      if (raw.trim().length === 0 || !Number.isFinite(n)) return undefined;
      return field.options?.find((o) => o.value.trim().length > 0 && Number(o.value) === n)?.value;
    }
    default:
      return raw;
  }
}

/** The values the files on a node actually hold, for the fields that live in files. */
export function readConfigValues(game: GameDefinition, files: ConfigFileContents[]): ConfigValues {
  const clean = (path: string) => path.replace(/^\.?\/+/, "");
  const byPath = new Map(files.map((f) => [clean(f.path), f.content]));
  const values: ConfigValues = {};

  for (const field of game.config) {
    const target = field.target;
    if (target.kind === "env" || target.kind === "arg" || target.kind === "json") continue;
    const content = byPath.get(clean(target.file));
    if (content === undefined) continue;

    let raw: string | undefined;
    switch (target.kind) {
      case "properties": {
        raw = readProperty(content, target.key);
        /* Taken off only when it is there: a line somebody edited to
           something else is shown as it is, so it reads as drift. */
        if (raw !== undefined && target.prefix && raw.startsWith(target.prefix)) raw = raw.slice(target.prefix.length);
        break;
      }
      case "ini":
        raw = readIniValue(content, target.section, target.key);
        break;
      case "lua":
        raw = readLuaValue(content, target.table, target.key);
        break;
      case "lua-base": {
        /* Only the shape Geeboard wrote names the preset; once the game
           has rewritten the file there is a table and no module, and the
           stored value is the only record of what it started from. */
        const base = readLuaValue(content, target.table, "");
        raw = base?.startsWith(target.prefix) ? base.slice(target.prefix.length) : undefined;
        break;
      }
    }
    if (raw === undefined) continue;

    const value = asValue(field, raw);
    if (value !== undefined) values[field.key] = value;
  }
  return values;
}

export interface ConfigDrift {
  key: string;
  label: string;
  /** What the panel last wrote. */
  stored: ConfigValue;
  /** What the file says now. */
  onServer: ConfigValue;
}

/** Where the server's own files disagree with what the panel stored. */
export function configDrift(
  game: GameDefinition,
  stored: ConfigValues,
  onServer: ConfigValues,
): ConfigDrift[] {
  const drift: ConfigDrift[] = [];
  for (const field of game.config) {
    if (!(field.key in onServer)) continue;
    const mine = stored[field.key] ?? field.default;
    const theirs = onServer[field.key]!;
    /* An empty stored value is "not set": the panel left this to the
       game or its preset, so whatever the file holds is not a
       disagreement with anything the panel wrote. */
    if (mine === "") continue;
    if (mine !== theirs) drift.push({ key: field.key, label: field.label, stored: mine, onServer: theirs });
  }
  return drift;
}

/** Applies a patch to a file's current contents, whatever its format. */
export function applyPatch(patch: ConfigFilePatch, existing: string): string {
  if (patch.format === "properties") return mergeProperties(existing, patch.entries);
  if (patch.format === "ini") return mergeIni(existing, patch.entries);
  if (patch.format === "lua") return mergeLua(existing, patch.entries, patch.path);

  /* No shipped game uses a JSON target yet. Writing a merger for one
     would be speculative; silently dropping the settings would not be
     acceptable, so this refuses loudly instead. */
  throw new PlatformError(
    "SERVER_INSTALLATION_FAILED",
    "Geeboard cannot write JSON configuration yet.",
    { details: { step: "configure", file: patch.path } },
  );
}

