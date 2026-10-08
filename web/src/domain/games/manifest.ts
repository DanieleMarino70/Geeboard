import { createHash } from "node:crypto";
import { auditDefinition } from "./audit";
import { defaultsFor, scopeToLine, validateConfig } from "./config";
import { DEFAULT_REGISTRIES, canonicalImage, parseImage, registryAllowed, registryRefusal, type ImageRef } from "./image-ref";
import { guardedTest, probeRegex } from "./regex-guard";
import { regexProblems } from "./safe-regex";
import {
  CAPABILITIES,
  type CapabilityId,
  type ConfigField,
  type ConfigTarget,
  type ConfigValue,
  type ConsoleDialect,
  type GameDefinition,
  type GameRequirements,
  type GameTemplate,
  type GameVersion,
  type HealthPolicy,
  type HealthProbe,
  type PortRole,
  type QueryProtocol,
} from "./types";

/* A game, written by somebody else.

   A manifest is a GameDefinition in JSON — all eight games Geeboard ships
   survive that round trip unchanged, so the format is the definition and
   there is nothing to translate. What is new is what is asked of it. A
   definition written by a developer is read before it is merged; a manifest is
   pasted by a person, and what it names is an image that will run on a node.
   So this validates it the other way round from audit(): that is a question of
   whether a definition is consistent, this one of whether it is safe to put in
   front of an owner at all.

   The rules, and why each is there, are in docs/community-games.md. Their
   shape here is a closed list. Every field has a type, a limit and a reason; a
   field the panel does not know is an error and not something to ignore — a
   field ignored today is where a manifest hides something that tomorrow's
   panel will read. What comes out is not the object that came in but a new one,
   built field by field from what was checked, so nothing that was not checked
   can be in it.

   The things that are never there, because there is nowhere to write them:
   privileged mode, capabilities, devices, host mounts, the host's network —
   the agent does not take them, and a test in the agent holds its container
   options to a fixed list.

   Pure apart from the timed run of each regular expression, which is `node:vm`
   and so server side. */

export const MANIFEST_VERSION = 1;
export const MAX_MANIFEST_CHARS = 64 * 1024;
const MAX_PROBLEMS = 60;
const MAX_DEPTH = 12;

export interface ManifestProblem {
  /** Where, as a path into the manifest: `versions[1].image`. Empty for the whole of it. */
  path: string;
  message: string;
}

export interface ManifestPolicy {
  /* The registries an image may come from. Default: Docker Hub and GitHub. "any" is for reading a manifest that was
     already approved: the list is about what may be proposed, and changing it does not unapprove anything. */
  registries?: readonly string[] | "any";
  /** Run each expression against lines built to hurt it. Default yes; off only for a test that has measured it already. */
  probe?: boolean;
}

export interface ManifestImage {
  /** `versions[i]`'s id. */
  version: string;
  ref: ImageRef;
  /** The image as written. */
  written: string;
  /** What the image is, whatever it is called: registry, repository and digest. */
  canonical: string;
}

export type ManifestResult =
  | {
      ok: true;
      /** What the panel will run with: built from what was checked, `official` false, the capability added. */
      definition: GameDefinition;
      /** The canonical JSON of what was given, and its SHA-256: what an owner's approval is bound to. */
      canonical: string;
      hash: string;
      images: ManifestImage[];
    }
  | { ok: false; problems: ManifestProblem[]; /** The hash of what was given, when it parsed — so a rejection can be named. */ hash: string | null };

/* ── What is reserved ─────────────────────────────────────────────── */

/* The families the panel groups servers by. `gamesInFamily` finds a game's
   definition through the name its servers were stored under, so a community
   game that took "Minecraft" would be taken for one of its editions. A test
   holds this to every game the registry ships, parked ones included. */
export const RESERVED_FAMILIES: readonly string[] = ["minecraft", "terraria", "project zomboid", "valheim", "rust", "palworld", "satisfactory"];

/* Ports the panel, the agent, the proxy and the machine itself listen on. A
   game's block that includes one would be refused by the node at the first
   create, or would sit on top of something that matters. */
export const RESERVED_PORTS: readonly number[] = [22, 80, 443, 2019, 3000, 5432, 8080, 8711];
/* 22 ssh, 80 and 443 the proxy, 2019 its admin, 3000 the panel, 5432 Postgres, 8080 the agent (its default: test/extension-guards.test.ts holds
   this to daemon/src/config.ts). Nothing in this repository listens on 8711; it was reserved with the others and stays, so that a block that
   includes it is refused as it always was. */

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FILE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,5}$/;
const DATA_PATH = /^(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,5}$/;
const SYSTEM_ROOTS = new Set(["bin", "boot", "dev", "etc", "lib", "lib64", "proc", "sbin", "sys", "usr"]);
const CONTROL = /[\u0000-\u001f\u007f\u{2028}\u{2029}]/u;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/* ── The small language the rules are written in ──────────────────── */

type Obj = Record<string, unknown>;

class Problems {
  list: ManifestProblem[] = [];
  add(path: string, message: string) {
    if (this.list.length < MAX_PROBLEMS) this.list.push({ path, message });
  }
  get any() {
    return this.list.length > 0;
  }
}

const key = (path: string, name: string) => (path ? `${path}.${name}` : name);
const at = (path: string, i: number) => `${path}[${i}]`;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function shape(
  value: unknown,
  path: string,
  p: Problems,
  known: readonly string[],
  required: readonly string[] = [],
  forbidden: Record<string, string> = {},
): Obj | null {
  if (!isObj(value)) {
    p.add(path, "has to be an object");
    return null;
  }
  for (const name of Object.keys(value)) {
    if (name in forbidden) p.add(key(path, name), forbidden[name]!);
    else if (!known.includes(name)) p.add(key(path, name), "is not a field a manifest may have");
  }
  for (const name of required) if (!(name in value)) p.add(key(path, name), "is required");
  return value;
}

function text(value: unknown, path: string, p: Problems, max: number, options: { min?: number; lines?: number; optional?: boolean } = {}): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== "string") {
    p.add(path, "has to be text");
    return undefined;
  }
  const min = options.min ?? 1;
  if (value.length < min) p.add(path, min === 1 ? "cannot be empty" : `has to be at least ${min} characters`);
  if (value.length > max) p.add(path, `is ${value.length} characters; the most is ${max}`);
  if (options.lines && options.lines > 1) {
    if (value.split("\n").length > options.lines) p.add(path, `has more than ${options.lines} lines`);
    if (/[\u0000-\u0009\u000b-\u001f\u007f\u{2028}\u{2029}]/u.test(value)) p.add(path, "has a control character");
  } else if (CONTROL.test(value)) {
    p.add(path, "has a control character or a line break");
  }
  return value;
}

function whole(value: unknown, path: string, p: Problems, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    p.add(path, "has to be a whole number");
    return undefined;
  }
  if (value < min || value > max) p.add(path, `has to be between ${min} and ${max}`);
  return value;
}

function flag(value: unknown, path: string, p: Problems): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    p.add(path, "has to be true or false");
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, p: Problems, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    p.add(path, `has to be one of: ${allowed.join(", ")}`);
    return undefined;
  }
  return value as T;
}

function list(value: unknown, path: string, p: Problems, min: number, max: number): unknown[] | null {
  if (!Array.isArray(value)) {
    p.add(path, "has to be a list");
    return null;
  }
  if (value.length < min) p.add(path, min === 1 ? "needs at least one" : `needs at least ${min}`);
  if (value.length > max) p.add(path, `has ${value.length}; the most is ${max}`);
  return value.length > max ? value.slice(0, max) : value;
}

function matching(value: unknown, path: string, p: Problems, pattern: RegExp, what: string, max = 120): string | undefined {
  const s = text(value, path, p, max);
  if (s !== undefined && !pattern.test(s)) p.add(path, `is not ${what}`);
  return s;
}

/** A record of text to text, with names from `names` and values within `valueMax`. */
function record(value: unknown, path: string, p: Problems, names: RegExp, what: string, maxEntries: number, valueMax: number): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value)) {
    p.add(path, "has to be an object");
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > maxEntries) p.add(path, `has ${entries.length} entries; the most is ${maxEntries}`);
  const out: Record<string, string> = {};
  for (const [name, v] of entries.slice(0, maxEntries)) {
    if (FORBIDDEN_KEYS.has(name) || !names.test(name)) {
      p.add(key(path, name), `is not ${what}`);
      continue;
    }
    const s = text(v, key(path, name), p, valueMax, { min: 0 });
    if (s !== undefined) out[name] = s;
  }
  return out;
}

function configValue(value: unknown, path: string, p: Problems): ConfigValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) p.add(path, "is not a usable number");
    return value;
  }
  if (typeof value === "string") return text(value, path, p, 500, { min: 0, lines: 1 });
  p.add(path, "has to be text, a number or true or false");
  return undefined;
}

function filePath(value: unknown, path: string, p: Problems): string | undefined {
  const s = text(value, path, p, 120);
  if (s !== undefined && (!FILE_PATH.test(s) || s.includes(".."))) {
    p.add(path, "has to be a path inside the server's own folder: no leading slash, no .., letters, digits, dots, dashes and underscores");
  }
  return s;
}

function mountPoint(value: unknown, path: string, p: Problems): string | undefined {
  const s = text(value, path, p, 120);
  if (s === undefined) return undefined;
  const root = s.split("/")[1] ?? "";
  if (!DATA_PATH.test(s) || s.includes("..")) p.add(path, "is not a valid mount point: absolute, at most five levels, letters, digits, dots, dashes and underscores");
  else if (SYSTEM_ROOTS.has(root) || s === "/var" || s === "/root") p.add(path, `${s} cannot be used as a mount point`);
  return s;
}

function envName(value: unknown, path: string, p: Problems): string | undefined {
  const s = text(value, path, p, 64);
  if (s === undefined) return undefined;
  if (!ENV_NAME.test(s)) p.add(path, "is not a valid environment variable name");
  else if (s.toUpperCase().startsWith("GEEBOARD_")) p.add(path, "starts with GEEBOARD_, which is the panel's to set");
  return s;
}

/* Every expression goes through the static check, and — when it is clean — a timed run. */
function pattern(value: unknown, path: string, p: Problems, probe: boolean): string | undefined {
  if (typeof value !== "string") {
    p.add(path, "has to be text, an expression");
    return undefined;
  }
  const problems = regexProblems(value);
  if (problems.length > 0) {
    p.add(path, problems[0]!);
    return value;
  }
  if (probe) {
    const result = probeRegex(value);
    if (!result.ok) p.add(path, `${result.reason} (starting ${JSON.stringify(result.input)})`);
  }
  return value;
}

/* ── The parts ────────────────────────────────────────────────────── */

function parsePorts(raw: unknown, path: string, p: Problems): PortRole[] {
  const out: PortRole[] = [];
  const items = list(raw, path, p, 1, 8);
  const ids = new Set<string>();
  const offsets = new Set<number>();
  items?.forEach((item, i) => {
    const where = at(path, i);
    const o = shape(item, where, p, ["id", "label", "offset", "protocol", "container", "primary", "public", "note"], ["id", "label", "offset", "protocol"]);
    if (!o) return;
    const id = matching(o.id, key(where, "id"), p, /^[a-z][a-z0-9-]{0,15}$/, "a short lower-case id", 16);
    if (id !== undefined) {
      if (ids.has(id)) p.add(key(where, "id"), `"${id}" is used twice`);
      ids.add(id);
    }
    // 24 is the agent's own limit on a port's label.
    const label = text(o.label, key(where, "label"), p, 24);
    const offset = whole(o.offset, key(where, "offset"), p, 0, 15);
    if (offset !== undefined) {
      if (offsets.has(offset)) p.add(key(where, "offset"), `${offset} is used twice`);
      offsets.add(offset);
    }
    const protocol = oneOf(o.protocol, key(where, "protocol"), p, ["tcp", "udp", "both"] as const);
    const container = o.container === undefined ? undefined : whole(o.container, key(where, "container"), p, 1, 65535);
    const primary = flag(o.primary, key(where, "primary"), p);
    const isPublic = flag(o.public, key(where, "public"), p);
    const note = o.note === undefined ? undefined : text(o.note, key(where, "note"), p, 120);
    if (id !== undefined && label !== undefined && offset !== undefined && protocol !== undefined) {
      out.push({ id, label, offset, protocol, ...(container !== undefined ? { container } : {}), ...(primary !== undefined ? { primary } : {}), ...(isPublic !== undefined ? { public: isPublic } : {}), ...(note !== undefined ? { note } : {}) });
    }
  });
  return out;
}

function parseRange(raw: unknown, path: string, p: Problems, min: number, max: number): [number, number] | undefined {
  const items = list(raw, path, p, 2, 2);
  if (!items || items.length !== 2) return undefined;
  const a = whole(items[0], at(path, 0), p, min, max);
  const b = whole(items[1], at(path, 1), p, min, max);
  if (a !== undefined && b !== undefined) {
    if (a > b) p.add(path, "runs backwards: the first number is the smaller");
    return [a, b];
  }
  return undefined;
}

function parseRequirements(raw: unknown, path: string, p: Problems): GameRequirements | undefined {
  const o = shape(raw, path, p, ["memoryGbMin", "cpuPctMin", "diskGbMin", "os", "arch", "capabilities"], ["memoryGbMin", "cpuPctMin", "diskGbMin", "os", "arch"]);
  if (!o) return undefined;
  const memoryGbMin = whole(o.memoryGbMin, key(path, "memoryGbMin"), p, 1, 64);
  const cpuPctMin = whole(o.cpuPctMin, key(path, "cpuPctMin"), p, 10, 3200);
  const diskGbMin = whole(o.diskGbMin, key(path, "diskGbMin"), p, 1, 2000);
  const setOf = <T extends string>(value: unknown, where: string, allowed: readonly T[]): T[] => {
    const items = list(value, where, p, 1, allowed.length) ?? [];
    return items.map((x, i) => oneOf(x, at(where, i), p, allowed)).filter((x): x is T => x !== undefined);
  };
  const os = setOf(o.os, key(path, "os"), ["linux", "windows"] as const);
  const arch = setOf(o.arch, key(path, "arch"), ["x64", "arm64"] as const);
  const declared = o.capabilities === undefined ? [] : (list(o.capabilities, key(path, "capabilities"), p, 0, CAPABILITIES.length) ?? []);
  const capabilities = declared.map((x, i) => oneOf(x, at(key(path, "capabilities"), i), p, CAPABILITIES as readonly CapabilityId[])).filter((x): x is CapabilityId => x !== undefined);
  // Added whatever the author wrote: Docker runs it, and the node has to have said it will run an image somebody chose.
  for (const needed of ["docker", "community-games"] as const) if (!capabilities.includes(needed)) capabilities.push(needed);
  if (memoryGbMin === undefined || cpuPctMin === undefined || diskGbMin === undefined) return undefined;
  return { memoryGbMin, cpuPctMin, diskGbMin, os, arch, capabilities };
}

function parseTarget(raw: unknown, path: string, p: Problems): ConfigTarget | undefined {
  if (!isObj(raw)) {
    p.add(path, "has to be an object");
    return undefined;
  }
  /* The type has a JSON target, and the panel cannot write one: applyPatch refuses it, loudly, at the
     first server somebody creates. A game that could be approved and then not be created is worse than
     one that is refused here, with the reason. */
  if (raw.kind === "json") {
    p.add(key(path, "kind"), "json is not a kind the panel can write yet; a setting can go in an environment variable, a properties or ini file, a Lua table or a command-line flag");
    return undefined;
  }
  const kind = oneOf(raw.kind, key(path, "kind"), p, ["env", "properties", "ini", "lua", "lua-base", "arg"] as const);
  const known: Record<string, string[]> = {
    env: ["kind", "name"],
    properties: ["kind", "file", "key", "prefix"],
    ini: ["kind", "file", "section", "key"],
    lua: ["kind", "file", "table", "key", "also"],
    "lua-base": ["kind", "file", "table", "prefix"],
    arg: ["kind", "flag"],
  };
  if (!kind) return undefined;
  shape(raw, path, p, known[kind]!, known[kind]!.filter((k) => k !== "prefix" && k !== "also"));
  const KEY = /^[A-Za-z0-9_.-]{1,100}$/;
  const LUA = /^[A-Za-z_][A-Za-z0-9_.]{0,60}$/;
  switch (kind) {
    case "env": {
      const name = envName(raw.name, key(path, "name"), p);
      return name === undefined ? undefined : { kind, name };
    }
    case "properties": {
      const file = filePath(raw.file, key(path, "file"), p);
      const k = matching(raw.key, key(path, "key"), p, KEY, "a plain key: letters, digits, dots, dashes and underscores", 100);
      const prefix = raw.prefix === undefined ? undefined : text(raw.prefix, key(path, "prefix"), p, 40);
      return file === undefined || k === undefined ? undefined : { kind, file, key: k, ...(prefix !== undefined ? { prefix } : {}) };
    }
    case "ini": {
      const file = filePath(raw.file, key(path, "file"), p);
      const section = matching(raw.section, key(path, "section"), p, /^[A-Za-z0-9_./ -]{1,100}$/, "a plain section name: letters, digits, dots, slashes, dashes, underscores and spaces", 100);
      const k = matching(raw.key, key(path, "key"), p, KEY, "a plain key: letters, digits, dots, dashes and underscores", 100);
      return file === undefined || section === undefined || k === undefined ? undefined : { kind, file, section, key: k };
    }
    case "lua": {
      const file = filePath(raw.file, key(path, "file"), p);
      const table = matching(raw.table, key(path, "table"), p, LUA, "the name of a Lua table", 61);
      const k = matching(raw.key, key(path, "key"), p, LUA, "a key inside a Lua table, dotted for a nested one", 61);
      let also: Array<{ key: string; value?: string; byValue?: Record<string, string> }> | undefined;
      if (raw.also !== undefined) {
        also = [];
        list(raw.also, key(path, "also"), p, 0, 6)?.forEach((item, i) => {
          const where = at(key(path, "also"), i);
          const o = shape(item, where, p, ["key", "value", "byValue"], ["key"]);
          if (!o) return;
          const ak = matching(o.key, key(where, "key"), p, LUA, "a key inside a Lua table", 61);
          const value = o.value === undefined ? undefined : text(o.value, key(where, "value"), p, 100, { min: 0 });
          const byValue = record(o.byValue, key(where, "byValue"), p, /^[A-Za-z0-9_. -]{1,60}$/, "a plain value", 30, 100);
          if (value === undefined && byValue === undefined) p.add(where, "has nothing to write: it needs a value or byValue");
          if (ak !== undefined) also!.push({ key: ak, ...(value !== undefined ? { value } : {}), ...(byValue !== undefined ? { byValue } : {}) });
        });
      }
      return file === undefined || table === undefined || k === undefined ? undefined : { kind, file, table, key: k, ...(also !== undefined ? { also } : {}) };
    }
    case "lua-base": {
      const file = filePath(raw.file, key(path, "file"), p);
      const table = matching(raw.table, key(path, "table"), p, LUA, "the name of a Lua table", 61);
      const prefix = matching(raw.prefix, key(path, "prefix"), p, /^[A-Za-z0-9_/.-]{1,60}$/, "a module prefix, like Sandbox/", 60);
      return file === undefined || table === undefined || prefix === undefined ? undefined : { kind, file, table, prefix };
    }
    case "arg": {
      const flagText = matching(raw.flag, key(path, "flag"), p, /^[-+A-Za-z0-9][A-Za-z0-9._:=+-]{0,60}$/, "a command-line flag", 61);
      return flagText === undefined ? undefined : { kind, flag: flagText };
    }
  }
}

function parseField(raw: unknown, path: string, p: Problems, probe: boolean): ConfigField | undefined {
  const o = shape(
    raw,
    path,
    p,
    ["key", "label", "type", "target", "default", "help", "group", "min", "max", "maxLength", "minLength", "requiredWhen", "mustNotContain", "pattern", "fromFiles", "fixedAfterCreation", "lines", "options", "restartRequired", "advanced", "secret"],
    ["key", "label", "type", "target", "default"],
  );
  if (!o) return undefined;
  const k = matching(o.key, key(path, "key"), p, /^[a-zA-Z][a-zA-Z0-9]{0,30}$/, "a camel-case name of letters and digits", 31);
  const label = text(o.label, key(path, "label"), p, 60, { lines: 1 });
  const type = oneOf(o.type, key(path, "type"), p, ["string", "text", "number", "boolean", "enum"] as const);
  const target = parseTarget(o.target, key(path, "target"), p);
  const def = configValue(o.default, key(path, "default"), p);
  const field: Partial<ConfigField> = {};
  if (o.help !== undefined) field.help = text(o.help, key(path, "help"), p, 300, { min: 0 });
  if (o.group !== undefined) field.group = text(o.group, key(path, "group"), p, 40);
  for (const bound of ["min", "max"] as const) {
    if (o[bound] !== undefined) field[bound] = whole(o[bound], key(path, bound), p, -1_000_000_000, 1_000_000_000);
  }
  if (o.maxLength !== undefined) field.maxLength = whole(o.maxLength, key(path, "maxLength"), p, 1, 4000);
  if (o.minLength !== undefined) field.minLength = whole(o.minLength, key(path, "minLength"), p, 0, 4000);
  if (o.requiredWhen !== undefined) {
    const r = shape(o.requiredWhen, key(path, "requiredWhen"), p, ["key", "equals"], ["key", "equals"]);
    if (r) {
      const rk = matching(r.key, key(path, "requiredWhen.key"), p, /^[a-zA-Z][a-zA-Z0-9]{0,30}$/, "a setting's key", 31);
      const equals = configValue(r.equals, key(path, "requiredWhen.equals"), p);
      if (rk !== undefined && equals !== undefined) field.requiredWhen = { key: rk, equals };
    }
  }
  if (o.mustNotContain !== undefined) field.mustNotContain = matching(o.mustNotContain, key(path, "mustNotContain"), p, /^[a-zA-Z][a-zA-Z0-9]{0,30}$/, "a setting's key", 31);
  if (o.pattern !== undefined) {
    const r = shape(o.pattern, key(path, "pattern"), p, ["regex", "message"], ["regex", "message"]);
    if (r) {
      const regex = pattern(r.regex, key(path, "pattern.regex"), p, probe);
      const message = text(r.message, key(path, "pattern.message"), p, 120, { lines: 1 });
      if (regex !== undefined && message !== undefined) field.pattern = { regex, message };
    }
  }
  if (o.fromFiles !== undefined) {
    const r = shape(o.fromFiles, key(path, "fromFiles"), p, ["extension", "action"], ["extension", "action"]);
    if (r) {
      const extension = matching(r.extension, key(path, "fromFiles.extension"), p, /^\.[a-z0-9]{1,8}$/, "a file extension like .wld", 9);
      const action = text(r.action, key(path, "fromFiles.action"), p, 40, { lines: 1 });
      if (extension !== undefined && action !== undefined) field.fromFiles = { extension, action };
    }
  }
  for (const name of ["fixedAfterCreation", "restartRequired", "advanced", "secret"] as const) {
    const v = flag(o[name], key(path, name), p);
    if (v !== undefined) field[name] = v;
  }
  if (o.lines !== undefined) {
    const items = list(o.lines, key(path, "lines"), p, 1, 8) ?? [];
    field.lines = items.map((x, i) => matching(x, at(key(path, "lines"), i), p, SLUG, "a version line's id", 61)).filter((x): x is string => x !== undefined);
  }
  if (o.options !== undefined) {
    const values = new Set<string>();
    field.options = (list(o.options, key(path, "options"), p, 1, 100) ?? []).flatMap((item, i) => {
      const where = at(key(path, "options"), i);
      const r = shape(item, where, p, ["value", "label"], ["value", "label"]);
      if (!r) return [];
      // An empty value is a real option: Zomboid's "no preset" is one.
      const value = text(r.value, key(where, "value"), p, 100, { min: 0, lines: 1 });
      const lbl = text(r.label, key(where, "label"), p, 60, { lines: 1 });
      if (value !== undefined) {
        if (values.has(value)) p.add(key(where, "value"), `"${value}" is offered twice`);
        values.add(value);
      }
      return value !== undefined && lbl !== undefined ? [{ value, label: lbl }] : [];
    });
  }
  if (k === undefined || label === undefined || type === undefined || target === undefined || def === undefined) return undefined;
  return { key: k, label, type, target, default: def, ...stripUndefined(field) } as ConfigField;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const QUERY_PROTOCOLS: readonly QueryProtocol[] = ["minecraft-ping", "source-a2s", "terraria-hello"];

function parseHealth(raw: unknown, path: string, p: Problems, probe: boolean): HealthPolicy | undefined {
  const o = shape(raw, path, p, ["probes", "bootGraceSeconds", "readyPattern", "crashPattern", "failures"], ["probes", "bootGraceSeconds"]);
  if (!o) return undefined;
  const probes: HealthProbe[] = [];
  list(o.probes, key(path, "probes"), p, 1, 8)?.forEach((item, i) => {
    const where = at(key(path, "probes"), i);
    if (!isObj(item)) return p.add(where, "has to be an object");
    const kind = oneOf(item.kind, key(where, "kind"), p, ["port", "log", "query", "rcon", "process"] as const);
    if (kind === "port") {
      const r = shape(item, where, p, ["kind", "port", "timeoutMs"], ["kind", "port"]);
      const port = r ? matching(r.port, key(where, "port"), p, /^[a-z][a-z0-9-]{0,15}$/, "a port role's id", 16) : undefined;
      const timeoutMs = r && r.timeoutMs !== undefined ? whole(r.timeoutMs, key(where, "timeoutMs"), p, 100, 30_000) : undefined;
      if (port !== undefined) probes.push({ kind, port, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    } else if (kind === "log") {
      const r = shape(item, where, p, ["kind", "pattern"], ["kind", "pattern"]);
      const pat = r ? pattern(r.pattern, key(where, "pattern"), p, probe) : undefined;
      if (pat !== undefined) probes.push({ kind, pattern: pat });
    } else if (kind === "query") {
      const r = shape(item, where, p, ["kind", "protocol", "port", "everySeconds", "when"], ["kind", "protocol"]);
      if (!r) return;
      const protocol = oneOf(r.protocol, key(where, "protocol"), p, QUERY_PROTOCOLS);
      const port = r.port === undefined ? undefined : matching(r.port, key(where, "port"), p, /^[a-z][a-z0-9-]{0,15}$/, "a port role's id", 16);
      const everySeconds = r.everySeconds === undefined ? undefined : whole(r.everySeconds, key(where, "everySeconds"), p, 1, 3600);
      let when: Array<{ key: string; equals: ConfigValue }> | undefined;
      if (r.when !== undefined) {
        when = [];
        list(r.when, key(where, "when"), p, 0, 5)?.forEach((c, j) => {
          const cw = at(key(where, "when"), j);
          const co = shape(c, cw, p, ["key", "equals"], ["key", "equals"]);
          if (!co) return;
          const ck = matching(co.key, key(cw, "key"), p, /^[a-zA-Z][a-zA-Z0-9]{0,30}$/, "a setting's key", 31);
          const equals = configValue(co.equals, key(cw, "equals"), p);
          if (ck !== undefined && equals !== undefined) when!.push({ key: ck, equals });
        });
      }
      if (protocol !== undefined) probes.push({ kind, protocol, ...(port !== undefined ? { port } : {}), ...(everySeconds !== undefined ? { everySeconds } : {}), ...(when !== undefined ? { when } : {}) });
    } else if (kind === "rcon") {
      const r = shape(item, where, p, ["kind", "command"], ["kind", "command"]);
      const command = r ? text(r.command, key(where, "command"), p, 120) : undefined;
      if (command !== undefined) probes.push({ kind, command });
    } else if (kind === "process") {
      shape(item, where, p, ["kind"], ["kind"]);
      probes.push({ kind });
    }
  });
  const bootGraceSeconds = whole(o.bootGraceSeconds, key(path, "bootGraceSeconds"), p, 0, 7200);
  const health: Partial<HealthPolicy> = {};
  if (o.readyPattern !== undefined) health.readyPattern = pattern(o.readyPattern, key(path, "readyPattern"), p, probe);
  if (o.crashPattern !== undefined) health.crashPattern = pattern(o.crashPattern, key(path, "crashPattern"), p, probe);
  if (o.failures !== undefined) {
    health.failures = (list(o.failures, key(path, "failures"), p, 0, 20) ?? []).flatMap((item, i) => {
      const where = at(key(path, "failures"), i);
      const r = shape(item, where, p, ["pattern", "reason"], ["pattern", "reason"]);
      if (!r) return [];
      const pat = pattern(r.pattern, key(where, "pattern"), p, probe);
      const reason = text(r.reason, key(where, "reason"), p, 200, { lines: 1 });
      return pat !== undefined && reason !== undefined ? [{ pattern: pat, reason }] : [];
    });
  }
  if (bootGraceSeconds === undefined) return undefined;
  return { probes, bootGraceSeconds, ...stripUndefined(health) };
}

function parseConsole(raw: unknown, path: string, p: Problems, probe: boolean): ConsoleDialect | undefined {
  const o = shape(raw, path, p, ["stopCommand", "stopGraceSeconds", "saveCommand", "resumeCommand", "saveReady", "broadcastCommand", "examples", "players", "healthLines"]);
  if (!o) return undefined;
  const out: Partial<ConsoleDialect> = {};
  for (const name of ["stopCommand", "saveCommand", "resumeCommand", "broadcastCommand"] as const) {
    if (o[name] !== undefined) out[name] = text(o[name], key(path, name), p, 120);
  }
  if (o.stopGraceSeconds !== undefined) out.stopGraceSeconds = whole(o.stopGraceSeconds, key(path, "stopGraceSeconds"), p, 1, 600);
  if (o.saveReady !== undefined) {
    const r = shape(o.saveReady, key(path, "saveReady"), p, ["command", "pattern", "timeoutSeconds"], ["command", "pattern"]);
    if (r) {
      const command = text(r.command, key(path, "saveReady.command"), p, 120);
      const pat = pattern(r.pattern, key(path, "saveReady.pattern"), p, probe);
      const timeoutSeconds = r.timeoutSeconds === undefined ? undefined : whole(r.timeoutSeconds, key(path, "saveReady.timeoutSeconds"), p, 1, 120);
      if (command !== undefined && pat !== undefined) out.saveReady = { command, pattern: pat, ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}) };
    }
  }
  if (o.examples !== undefined) out.examples = (list(o.examples, key(path, "examples"), p, 0, 20) ?? []).map((x, i) => text(x, at(key(path, "examples"), i), p, 120)).filter((x): x is string => x !== undefined);
  if (o.players !== undefined) {
    const r = shape(o.players, key(path, "players"), p, ["join", "leave", "connect"], ["join", "leave"]);
    if (r) {
      const join = pattern(r.join, key(path, "players.join"), p, probe);
      const leave = pattern(r.leave, key(path, "players.leave"), p, probe);
      const connect = r.connect === undefined ? undefined : pattern(r.connect, key(path, "players.connect"), p, probe);
      if (join !== undefined && leave !== undefined) out.players = { join, leave, ...(connect !== undefined ? { connect } : {}) };
    }
  }
  if (o.healthLines !== undefined) out.healthLines = pattern(o.healthLines, key(path, "healthLines"), p, probe);
  return stripUndefined(out);
}

function parseVersions(raw: unknown, path: string, p: Problems, registries: readonly string[] | "any", images: ManifestImage[]): GameVersion[] {
  const out: GameVersion[] = [];
  const ids = new Set<string>();
  let recommended = 0;
  list(raw, path, p, 1, 30)?.forEach((item, i) => {
    const where = at(path, i);
    const o = shape(
      item,
      where,
      p,
      ["id", "formerIds", "line", "label", "upstream", "image", "note", "released", "channel", "recommended", "supported", "env", "args"],
      ["id", "label", "image", "note", "released", "channel"],
      {
        download: "a version's files come from its image: a download is a request the panel would make to an address the manifest chose",
        steamBranch: "versions come from the manifest, not from Steam: only the static source is allowed",
      },
    );
    if (!o) return;
    const id = matching(o.id, key(where, "id"), p, SLUG, "an id of lower-case letters, digits, dots and dashes", 61);
    if (id !== undefined) {
      if (ids.has(id)) p.add(key(where, "id"), `"${id}" is used twice`);
      ids.add(id);
    }
    const formerIds = o.formerIds === undefined ? undefined : (list(o.formerIds, key(where, "formerIds"), p, 0, 5) ?? []).map((x, j) => matching(x, at(key(where, "formerIds"), j), p, SLUG, "an id", 61)).filter((x): x is string => x !== undefined);
    const line = o.line === undefined ? undefined : matching(o.line, key(where, "line"), p, SLUG, "a line's id", 61);
    const label = text(o.label, key(where, "label"), p, 60, { lines: 1 });
    const upstream = o.upstream === undefined ? undefined : text(o.upstream, key(where, "upstream"), p, 60, { lines: 1 });
    const note = text(o.note, key(where, "note"), p, 200, { lines: 1 });
    const released = text(o.released, key(where, "released"), p, 10, { min: 10 });
    if (released !== undefined && !isCalendarDate(released)) p.add(key(where, "released"), "has to be a date, as 2026-10-03");
    const channel = oneOf(o.channel, key(where, "channel"), p, ["stable", "snapshot", "preview", "legacy"] as const);
    const isRecommended = flag(o.recommended, key(where, "recommended"), p);
    if (isRecommended) recommended++;
    const supported = flag(o.supported, key(where, "supported"), p);
    const env = record(o.env, key(where, "env"), p, ENV_NAME, "a valid environment variable name", 32, 512);
    if (env) {
      for (const name of Object.keys(env)) if (name.toUpperCase().startsWith("GEEBOARD_")) p.add(key(key(where, "env"), name), "starts with GEEBOARD_, which is the panel's to set");
    }
    const args = o.args === undefined ? undefined : (list(o.args, key(where, "args"), p, 0, 16) ?? []).map((x, j) => text(x, at(key(where, "args"), j), p, 200)).filter((x): x is string => x !== undefined);

    let image: string | undefined;
    if (typeof o.image !== "string") {
      p.add(key(where, "image"), "has to be text: an image reference");
    } else {
      const parsed = parseImage(o.image);
      if (!parsed.ok) p.add(key(where, "image"), parsed.reason);
      else if (registries !== "any" && !registryAllowed(parsed.ref, registries)) p.add(key(where, "image"), registryRefusal(parsed.ref, registries));
      else {
        image = o.image;
        if (id !== undefined) images.push({ version: id, ref: parsed.ref, written: o.image, canonical: canonicalImage(parsed.ref) });
      }
    }
    if (id !== undefined && label !== undefined && image !== undefined && note !== undefined && released !== undefined && channel !== undefined) {
      out.push({
        id,
        ...(formerIds && formerIds.length > 0 ? { formerIds } : {}),
        ...(line !== undefined ? { line } : {}),
        label,
        ...(upstream !== undefined ? { upstream } : {}),
        image,
        note,
        released,
        channel,
        ...(isRecommended !== undefined ? { recommended: isRecommended } : {}),
        ...(supported !== undefined ? { supported } : {}),
        ...(env ? { env } : {}),
        ...(args ? { args } : {}),
      });
    }
  });
  if (recommended > 1) p.add(path, "has more than one version marked recommended");
  if (out.length > 0 && !out.some((v) => v.supported !== false)) p.add(path, "has no version that can be installed: every one is marked supported: false");
  return out;
}

function parseTemplates(raw: unknown, path: string, p: Problems): GameTemplate[] {
  const out: GameTemplate[] = [];
  const ids = new Set<string>();
  list(raw, path, p, 1, 10)?.forEach((item, i) => {
    const where = at(path, i);
    const o = shape(item, where, p, ["id", "name", "blurb", "summary", "config"], ["id", "name", "blurb", "summary", "config"]);
    if (!o) return;
    const id = matching(o.id, key(where, "id"), p, SLUG, "an id of lower-case letters, digits, dots and dashes", 61);
    if (id !== undefined) {
      if (ids.has(id)) p.add(key(where, "id"), `"${id}" is used twice`);
      ids.add(id);
    }
    const name = text(o.name, key(where, "name"), p, 40, { lines: 1 });
    const blurb = text(o.blurb, key(where, "blurb"), p, 160, { lines: 1 });
    const summary = text(o.summary, key(where, "summary"), p, 160, { lines: 1 });
    let config: Record<string, ConfigValue> | undefined;
    if (isObj(o.config)) {
      config = {};
      const entries = Object.entries(o.config);
      if (entries.length > 60) p.add(key(where, "config"), "has more than 60 settings");
      for (const [name2, v] of entries.slice(0, 60)) {
        if (FORBIDDEN_KEYS.has(name2) || !/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(name2)) {
          p.add(key(key(where, "config"), name2), "is not a setting's key");
          continue;
        }
        const value = configValue(v, key(key(where, "config"), name2), p);
        if (value !== undefined) config[name2] = value;
      }
    } else {
      p.add(key(where, "config"), "has to be an object");
    }
    if (id !== undefined && name !== undefined && blurb !== undefined && summary !== undefined && config !== undefined) out.push({ id, name, blurb, summary, config });
  });
  return out;
}

/* ── Canonical form and hash ──────────────────────────────────────── */

/** The same JSON whatever the spacing and the order of the keys: what an approval is bound to. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function hashOf(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/* A date that exists. `Date.parse` takes 2026-02-31 and calls it March the third. */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function depthOf(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") return depth;
  const children = Array.isArray(value) ? value : Object.values(value as Obj);
  return children.reduce<number>((deepest, child) => Math.max(deepest, depthOf(child, depth + 1)), depth + 1);
}

/* ── The manifest ─────────────────────────────────────────────────── */

const TOP = [
  "manifest",
  "id",
  "name",
  "family",
  "art",
  "official",
  "blurb",
  "portBase",
  "portSpan",
  "ports",
  "defaults",
  "limits",
  "requirements",
  "dataPath",
  "cachePaths",
  "resourceEnv",
  "install",
  "config",
  "health",
  "console",
  "versions",
  "templates",
  "versionSources",
] as const;

export function validateManifest(input: unknown, policy: ManifestPolicy = {}): ManifestResult {
  const registries = policy.registries ?? DEFAULT_REGISTRIES;
  const probe = policy.probe !== false;
  const p = new Problems();

  let parsed: unknown = input;
  if (typeof input === "string") {
    if (input.length > MAX_MANIFEST_CHARS) {
      return { ok: false, hash: null, problems: [{ path: "", message: `is ${input.length} characters; the most is ${MAX_MANIFEST_CHARS}` }] };
    }
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      const where = /position (\d+)/.exec((error as Error).message)?.[1];
      return { ok: false, hash: null, problems: [{ path: "", message: `is not JSON${where ? `: it goes wrong at character ${where}` : ""}. A manifest is plain JSON, with no comments` }] };
    }
  }
  if (depthOf(parsed) > MAX_DEPTH) {
    return { ok: false, hash: null, problems: [{ path: "", message: `nests deeper than ${MAX_DEPTH} levels` }] };
  }
  const canonical = canonicalJson(parsed);
  if (canonical.length > MAX_MANIFEST_CHARS) {
    return { ok: false, hash: null, problems: [{ path: "", message: `is ${canonical.length} characters once written out; the most is ${MAX_MANIFEST_CHARS}` }] };
  }
  const hash = hashOf(canonical);

  const o = shape(parsed, "", p, TOP, ["manifest", "id", "name", "family", "art", "blurb", "portBase", "portSpan", "ports", "defaults", "limits", "requirements", "install", "config", "health", "console", "versions", "templates"], {
    mods: "a manifest cannot carry mods in this release: a game that downloads them from the Steam Workshop is a rule of trust of its own",
    srv: "a manifest cannot ask for an SRV record in this release: it would write a record into the owner's own DNS zone, which is a rule of trust of its own",
  });
  if (!o) return { ok: false, hash, problems: p.list };

  if (o.manifest !== MANIFEST_VERSION) p.add("manifest", `has to be ${MANIFEST_VERSION}: the version of this format`);
  const id = matching(o.id, "id", p, /^community-[a-z0-9][a-z0-9-]{1,30}$/, "a community game's id: community- and a short lower-case name", 40);
  const name = text(o.name, "name", p, 60, { lines: 1 });
  const family = text(o.family, "family", p, 40, { lines: 1 });
  if (family !== undefined && RESERVED_FAMILIES.includes(family.trim().toLowerCase())) p.add("family", `"${family}" is the name of a game Geeboard ships; servers are grouped by it`);
  const art = text(o.art, "art", p, 30, { lines: 2 });
  if (art !== undefined && art.split("\n").some((line) => line.length > 14)) p.add("art", "has a line longer than 14 characters");
  if (o.official !== undefined && o.official !== false) p.add("official", "has to be false or left out: only the games Geeboard ships are official");
  const blurb = text(o.blurb, "blurb", p, 280, { lines: 1 });

  const portBase = whole(o.portBase, "portBase", p, 1024, 65000);
  const portSpan = whole(o.portSpan, "portSpan", p, 1, 2000);
  const ports = parsePorts(o.ports, "ports", p);
  if (ports.filter((x) => x.primary).length > 1) p.add("ports", "has more than one primary port");

  const defaultsO = shape(o.defaults, "defaults", p, ["memoryGb", "cpuLimit", "diskGb", "playersMax"], ["memoryGb", "cpuLimit", "diskGb", "playersMax"]);
  const defaults = defaultsO && {
    memoryGb: whole(defaultsO.memoryGb, "defaults.memoryGb", p, 1, 64),
    cpuLimit: whole(defaultsO.cpuLimit, "defaults.cpuLimit", p, 10, 3200),
    diskGb: whole(defaultsO.diskGb, "defaults.diskGb", p, 1, 2000),
    playersMax: whole(defaultsO.playersMax, "defaults.playersMax", p, 1, 1000),
  };
  const limitsO = shape(o.limits, "limits", p, ["memoryGb", "cpuLimit", "diskGb"], ["memoryGb", "cpuLimit", "diskGb"]);
  const limits = limitsO && {
    memoryGb: parseRange(limitsO.memoryGb, "limits.memoryGb", p, 1, 64),
    cpuLimit: parseRange(limitsO.cpuLimit, "limits.cpuLimit", p, 10, 3200),
    diskGb: parseRange(limitsO.diskGb, "limits.diskGb", p, 1, 2000),
  };
  const requirements = parseRequirements(o.requirements, "requirements", p);

  const dataPath = o.dataPath === undefined ? undefined : mountPoint(o.dataPath, "dataPath", p);
  let cachePaths: string[] | undefined;
  if (o.cachePaths !== undefined) {
    cachePaths = (list(o.cachePaths, "cachePaths", p, 0, 2) ?? []).map((x, i) => mountPoint(x, at("cachePaths", i), p)).filter((x): x is string => x !== undefined);
  }
  {
    const all = [dataPath ?? "/data", ...(cachePaths ?? [])];
    for (let i = 0; i < all.length; i++) {
      for (let j = 0; j < all.length; j++) {
        if (i !== j && (all[i] === all[j] || all[i]!.startsWith(`${all[j]}/`))) p.add(i === 0 ? "dataPath" : at("cachePaths", i - 1), `${all[i]} overlaps another mount point`);
      }
    }
  }

  let resourceEnv: GameDefinition["resourceEnv"];
  if (o.resourceEnv !== undefined) {
    const r = shape(o.resourceEnv, "resourceEnv", p, ["memory", "ports", "secrets"]);
    if (r) {
      const built: NonNullable<GameDefinition["resourceEnv"]> = {};
      if (r.memory !== undefined) {
        const m = shape(r.memory, "resourceEnv.memory", p, ["name", "percent"], ["name", "percent"]);
        if (m) {
          const n = envName(m.name, "resourceEnv.memory.name", p);
          const percent = whole(m.percent, "resourceEnv.memory.percent", p, 10, 95);
          if (n !== undefined && percent !== undefined) built.memory = { name: n, percent };
        }
      }
      if (r.ports !== undefined) {
        if (!isObj(r.ports)) p.add("resourceEnv.ports", "has to be an object");
        else {
          built.ports = {};
          for (const [role, v] of Object.entries(r.ports)) {
            if (FORBIDDEN_KEYS.has(role) || !/^[a-z][a-z0-9-]{0,15}$/.test(role)) p.add(key("resourceEnv.ports", role), "is not a port role's id");
            else {
              const n = envName(v, key("resourceEnv.ports", role), p);
              if (n !== undefined) built.ports[role] = n;
            }
          }
        }
      }
      if (r.secrets !== undefined) {
        if (!isObj(r.secrets)) p.add("resourceEnv.secrets", "has to be an object");
        else {
          built.secrets = {};
          for (const [n, v] of Object.entries(r.secrets)) {
            if (FORBIDDEN_KEYS.has(n)) p.add(key("resourceEnv.secrets", n), "is not a variable name");
            else if (envName(n, key("resourceEnv.secrets", n), p) !== undefined) {
              const prefix = matching(v, key("resourceEnv.secrets", n), p, /^[a-z][a-z0-9]{2,15}$/, "a short lower-case prefix, 3 to 16 letters and digits", 16);
              if (prefix !== undefined) built.secrets[n] = prefix;
            }
          }
        }
      }
      resourceEnv = built;
    }
  }

  let install: GameDefinition["install"] | undefined;
  {
    const r = shape(o.install, "install", p, ["kind", "env", "files"], ["kind"]);
    if (r) {
      if (r.kind !== "image") p.add("install.kind", "has to be \"image\": the image installs the server itself. Other strategies download from an address the manifest chooses, and have no installer anyway");
      const env = record(r.env, "install.env", p, ENV_NAME, "a valid environment variable name", 32, 512);
      if (env) for (const n of Object.keys(env)) if (n.toUpperCase().startsWith("GEEBOARD_")) p.add(key("install.env", n), "starts with GEEBOARD_, which is the panel's to set");
      let files: Array<{ file: string; kind: "properties"; entries: Record<string, string> }> | undefined;
      if (r.files !== undefined) {
        files = [];
        list(r.files, "install.files", p, 0, 8)?.forEach((item, i) => {
          const where = at("install.files", i);
          const f = shape(item, where, p, ["file", "kind", "entries"], ["file", "kind", "entries"]);
          if (!f) return;
          const file = filePath(f.file, key(where, "file"), p);
          if (f.kind !== "properties") p.add(key(where, "kind"), "has to be \"properties\": the only kind of file a game can ask to have written");
          const entries = record(f.entries, key(where, "entries"), p, /^[A-Za-z0-9_.-]{1,100}$/, "a plain key", 64, 512);
          if (file !== undefined && entries !== undefined) files!.push({ file, kind: "properties", entries });
        });
      }
      if (r.kind === "image") install = { kind: "image", ...(env ? { env } : {}), ...(files ? { files } : {}) };
    }
  }

  const config = (list(o.config, "config", p, 0, 60) ?? []).map((f, i) => parseField(f, at("config", i), p, probe)).filter((x): x is ConfigField => x !== undefined);
  const health = parseHealth(o.health, "health", p, probe);
  const consoleDialect = parseConsole(o.console, "console", p, probe);
  const images: ManifestImage[] = [];
  const versions = parseVersions(o.versions, "versions", p, registries, images);
  const templates = parseTemplates(o.templates, "templates", p);

  if (o.versionSources !== undefined && canonicalJson(o.versionSources) !== canonicalJson([{ provider: "static" }])) {
    p.add("versionSources", "has to be [{ \"provider\": \"static\" }] or left out: a community game's versions are the ones its manifest lists");
  }

  /* The block of ports an allocation may reach, against the ports that belong to something else. */
  if (portBase !== undefined && portSpan !== undefined && ports.length > 0) {
    const stride = Math.max(...ports.map((x) => x.offset)) + 1;
    const last = portBase + portSpan + stride - 2;
    if (last > 65535) p.add("portSpan", `lets a block reach port ${last}; the highest is 65535`);
    const hit = RESERVED_PORTS.filter((port) => port >= portBase && port <= last);
    if (hit.length > 0) p.add("portBase", `the block ${portBase}–${last} includes ${hit.join(", ")}, which the machine, the proxy, the panel or the agent uses`);
  }

  for (const [i, probeDef] of (health?.probes ?? []).entries()) {
    if ((probeDef.kind === "port" || probeDef.kind === "query") && probeDef.port && !ports.some((x) => x.id === probeDef.port)) {
      p.add(at("health.probes", i) + ".port", `"${probeDef.port}" is not one of the game's ports`);
    }
  }

  if (
    p.any ||
    id === undefined ||
    name === undefined ||
    family === undefined ||
    art === undefined ||
    blurb === undefined ||
    portBase === undefined ||
    portSpan === undefined ||
    !defaults ||
    defaults.memoryGb === undefined ||
    defaults.cpuLimit === undefined ||
    defaults.diskGb === undefined ||
    defaults.playersMax === undefined ||
    !limits ||
    !limits.memoryGb ||
    !limits.cpuLimit ||
    !limits.diskGb ||
    !requirements ||
    !install ||
    !health ||
    !consoleDialect
  ) {
    return { ok: false, hash, problems: p.list };
  }

  const definition: GameDefinition = {
    id,
    name,
    family,
    art,
    official: false,
    blurb,
    portBase,
    portSpan,
    ports,
    defaults: { memoryGb: defaults.memoryGb, cpuLimit: defaults.cpuLimit, diskGb: defaults.diskGb, playersMax: defaults.playersMax },
    limits: { memoryGb: limits.memoryGb, cpuLimit: limits.cpuLimit, diskGb: limits.diskGb },
    requirements,
    ...(dataPath !== undefined ? { dataPath } : {}),
    ...(cachePaths && cachePaths.length > 0 ? { cachePaths } : {}),
    ...(resourceEnv ? { resourceEnv } : {}),
    install,
    config,
    health,
    console: consoleDialect,
    versions,
    templates,
    versionSources: [{ provider: "static" }],
  };

  /* Consistency, with the rules the games Geeboard ships are held to ... */
  for (const problem of auditDefinition(definition)) p.add("", problem.replace(`${definition.id}: `, ""));

  /* ... and what the wizard would do with it: every default, and every template over the defaults, on every line. */
  if (!p.any) {
    // Only a line somebody can create on: a retired version's line may have no settings left, and nothing is made from it.
    const lines = [...new Set(versions.filter((v) => v.supported !== false).map((v) => v.line))];
    for (const line of lines) {
      const scoped = scopeToLine(definition, line);
      const where = line ? ` on the line "${line}"` : "";
      for (const problem of validateConfig(scoped, defaultsFor(scoped), guardedTest)) p.add("config", `the default of ${problem.key}${where} ${problem.message}`);
      templates.forEach((template, i) => {
        for (const problem of validateConfig(scoped, { ...defaultsFor(scoped), ...template.config }, guardedTest)) {
          p.add(at("templates", i), `${template.name}: ${problem.key}${where} ${problem.message}`);
        }
      });
    }
  }
  if (p.any) return { ok: false, hash, problems: p.list };

  return { ok: true, definition, canonical, hash, images };
}
