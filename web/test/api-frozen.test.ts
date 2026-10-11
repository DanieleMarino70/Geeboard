import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SCOPE_PERMISSIONS } from "../src/domain/access/permissions.ts";
import { WEBHOOK_EVENTS, removeBody, setBody, testBody } from "../src/domain/dns/webhook.ts";
import { STATUS, type ErrorCode } from "../src/domain/errors.ts";
import { findGame } from "../src/domain/games/registry.ts";
import { RANGE_SECONDS } from "../src/domain/metrics/ranges.ts";
import { ALL_KINDS } from "../src/domain/notify/events.ts";
import { webhookPayload } from "../src/domain/notify/format.ts";
import { backupShape, eventShape, gameShape, nodeShape, serverShape, taskShape } from "../src/app/api/v1/_shape.ts";

/* docs/api-frozen.md is what 1.0 promises will not be renamed, removed or given another meaning inside a major version: every route under
   /api/v1, the names each takes and answers with, every field of every shape, the values of every enumeration a client switches on, and the
   two webhooks' bodies and headers. This holds the page and the code together, in both directions: a frozen name the code no longer has fails,
   and so does a name the code sends that the page does not list, so that adding is a row on the page in the same change and renaming is never
   quiet. The shapes are built from rows made up here, without a database; what is built inside a route is read from the route's file. */

const WEB = path.join(import.meta.dirname, "..");
const ROOT = path.join(WEB, "..");
const API = path.join(WEB, "src", "app", "api", "v1");
const lf = (text: string) => text.split("\r\n").join("\n");
const read = (file: string) => lf(readFileSync(path.join(ROOT, file), "utf8"));
const FROZEN = read("docs/api-frozen.md");
const API_DOC = read("docs/api.md");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/* ── Reading the page ───────────────────────────────────────────── */

/** The text under a `## heading`, to the next one. */
function part(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The rows of the tables in a text whose first cell is code, as their cells. */
function rows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) => line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
}

/** What is written as code in a cell. */
const ticks = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** The `### name` subsections of a part, each with the line that says where it is built and its fields. */
function shapes(text: string): Array<{ name: string; by: string | null; file: string | null; fields: string[] }> {
  return text
    .split(/\n### /)
    .slice(1)
    .map((chunk) => {
      const name = chunk.slice(0, chunk.indexOf("\n")).trim();
      const built = /Built (?:by `(\w+)` in|in) `([^`]+)`/.exec(chunk);
      return { name, by: built?.[1] ?? null, file: built?.[2] ?? null, fields: rows(chunk).map((cells) => ticks(cells[0]!)[0]!) };
    });
}

/* ── The handlers ───────────────────────────────────────────────── */

interface Handler {
  key: string; // "GET /servers/:id/start"
  files: string[]; // the route, and the `_` helpers beside it and above it
}

function handlers(): Handler[] {
  const out: Handler[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const rel = path.relative(API, path.dirname(full)).split(path.sep).filter(Boolean);
        const route = "/" + rel.map((s) => s.replace(/^\[(\w+)\]$/, ":$1")).join("/");
        const source = readFileSync(full, "utf8");
        const files = [full];
        for (let at = path.dirname(full); at.startsWith(API); at = path.dirname(at)) {
          for (const helper of readdirSync(at)) if (/^_.*\.ts$/.test(helper)) files.push(path.join(at, helper));
        }
        for (const method of METHODS) {
          if (new RegExp(`export (?:async )?function ${method}\\b`).test(source)) out.push({ key: `${method} ${route}`, files });
        }
      }
    }
  };
  walk(API);
  return out;
}

const word = (name: string) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);

/** What the page's table of routes says that the code does not, and the handlers it leaves out. */
function routeProblems(text: string): string[] {
  const problems: string[] = [];
  const all = handlers();
  const byKey = new Map(all.map((h) => [h.key, h]));
  const listed = new Set<string>();
  for (const cells of rows(part(text, "Routes"))) {
    const [route] = ticks(cells[0]!);
    const match = /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1(\/.*)$/.exec(route ?? "");
    if (!match) {
      problems.push(`not a route: ${cells[0]}`);
      continue;
    }
    const key = `${match[1]} ${match[2]}`;
    listed.add(key);
    const handler = byKey.get(key);
    if (!handler) {
      problems.push(`${key}: frozen, and there is no handler`);
      continue;
    }
    const source = handler.files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const cell of cells.slice(1)) {
      for (const token of ticks(cell).map((t) => t.replace(/^\?/, ""))) {
        if (!/^[A-Za-z][\w-]*$/.test(token)) continue;
        if (!word(token).test(source)) problems.push(`${key}: \`${token}\` is frozen, and its route no longer has it`);
      }
    }
  }
  for (const h of all) if (!listed.has(h.key)) problems.push(`${h.key}: a handler with no row in docs/api-frozen.md`);
  return problems;
}

/* ── The shapes ─────────────────────────────────────────────────── */

const at = new Date("2026-10-11T10:00:00.000Z");

/* A row of each, with every column set, so that a field the shape leaves out when a column is empty is still seen. */
const SERVER = {
  id: "clsrv", slug: "aurora", name: "Aurora", state: "RUNNING", gameId: "terraria", game: "Terraria", gameVersionId: "clver", version: "Terraria 1.4.4.9",
  runtime: "DOCKER", host: "aurora.example.com", port: 7777, playersOn: 3, playersMax: 16, memoryLimit: 2, cpuLimit: 150, diskQuota: 10,
  cpuPct: 12, ramPct: 40, startedAt: at, createdAt: at, lastError: null, ownerId: "clusr",
  node: { name: "fra-node-02", region: "eu-central" },
  gameVersionRef: { slug: "vanilla-1-4-4-9" },
  dnsRecords: [{ kind: "A", name: "aurora.example.com", content: "203.0.113.9", checkedAt: at, error: null }],
};
const NODE = {
  name: "fra-node-02", region: "eu-central", city: "Frankfurt", state: "HEALTHY", runtime: "DOCKER", os: "linux", arch: "x64", capabilities: ["docker"],
  daemon: "0.11.0", contract: 1, daemonUrl: "http://10.0.0.2:8711", daemonToken: "sealed", lastSeenAt: at, lastReachedAt: at, pingMs: 9,
  cpuCores: 8, ramTotal: 32, diskTotal: 500, cpuPct: 20, ramPct: 30, diskPct: 40,
};
const BACKUP = {
  id: "clbak", serverId: null, server: null, originServerName: "Aurora", originGameId: "terraria", name: "manual-10-11", state: "LOCKED", trigger: "MANUAL",
  store: "S3", sizeBytes: BigInt(812), checksum: "sha256:00", durationMs: 41, error: null, verifiedAt: at, verifyError: null, createdAt: at,
};
const TASK = {
  id: "cltsk", serverId: "clsrv", server: { slug: "aurora" }, name: "Nightly", kind: "BACKUP", cron: "0 4 * * *", payload: null, enabled: true,
  lastRunAt: at, lastResult: "SUCCEEDED", nextRunAt: at,
};
const EVENT = {
  id: "clevt", createdAt: at, actor: "Mara", userId: "clusr", action: "console.command", target: "say hi", targetHidden: false, tone: "INFO",
  server: { slug: "aurora", name: "Aurora" }, originServerName: null, originServerSlug: null, changes: { Name: { from: "a", to: "b" } },
};
const MESSAGE = {
  kind: "server.crashed", at: at.toISOString(), tone: "warning" as const, title: "Aurora crashed", text: "…", server: { name: "Aurora", slug: "aurora" },
  node: { name: "fra-node-02" }, count: 1, link: "https://panel.example.com/servers/aurora", details: { "Exit code": "1" },
};

/* What builds each shape the page says is built by a function. A section that names a function missing here fails: teach this file to build it. */
const BUILDERS: Record<string, () => unknown> = {
  gameShape: () => gameShape(findGame("terraria")!),
  nodeShape: () => nodeShape(NODE as never, { servers: 1 }),
  serverShape: () =>
    serverShape(SERVER as never, { provider: { kind: "cloudflare", zone: "example.com" }, node: { publicAddress: "203.0.113.9", publicAddress6: null, observedAddress: null } }),
  backupShape: () => backupShape(BACKUP as never),
  taskShape: () => taskShape(TASK as never),
  eventShape: () => eventShape(EVENT as never),
  webhookPayload: () => webhookPayload(MESSAGE),
  setBody: () => setBody("example.com", { kind: "SRV", name: "_minecraft._tcp.aurora.example.com", content: "0 5 25565 aurora.example.com" }, "geeboard", at),
  removeBody: () => removeBody("example.com", { kind: "A", name: "aurora.example.com" }, at),
  testBody: () => testBody("example.com", at),
};

/** Every path in a value, and the ones that end in nothing (null, an empty list, an empty object), whose insides cannot be seen. */
function paths(value: unknown): { all: Set<string>; empty: Set<string> } {
  const all = new Set<string>();
  const empty = new Set<string>();
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) {
      if (v.length === 0) empty.add(at);
      if (v.length === 0 || v.every((item) => item === null || typeof item !== "object")) all.add(at);
      else for (const item of v) walk(item, `${at}[]`);
      return;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const keys = Object.keys(v);
      if (keys.length === 0) {
        all.add(at);
        empty.add(at);
      }
      for (const key of keys) walk((v as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
      return;
    }
    if (v === null || v === undefined) empty.add(at);
    all.add(at);
  };
  walk(value, "");
  return { all, empty };
}

/** `a.b[].c` and the paths above it: `a`, `a.b`, `a.b[]`. */
function above(field: string): string[] {
  const out: string[] = [];
  const parts = field.split(".");
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join(".");
    out.push(head, head.replace(/\[\]$/, ""));
  }
  return out;
}

/** Where a shape built by a function and the page's list of its fields part, both ways. */
function builtProblems(name: string, value: unknown, fields: string[]): string[] {
  const { all, empty } = paths(value);
  const problems: string[] = [];
  const frozen = new Set(fields);
  for (const field of fields) {
    const sent = all.has(field) || [...all].some((p) => p.startsWith(`${field}.`) || p.startsWith(`${field}[]`));
    const unseen = above(field).some((p) => empty.has(p));
    if (!sent && !unseen) problems.push(`${name}: \`${field}\` is frozen, and the shape no longer sends it`);
  }
  for (const p of all) {
    if (frozen.has(p) || above(p).some((q) => frozen.has(q))) continue;
    problems.push(`${name}: sends \`${p}\`, which docs/api-frozen.md does not list`);
  }
  return problems;
}

/** Where a shape built inside a file and the page part: a frozen name the file no longer has. */
function sourceProblems(name: string, file: string, fields: string[]): string[] {
  if (!existsSync(path.join(ROOT, file))) return [`${name}: ${file} is not there`];
  const source = read(file);
  const problems: string[] = [];
  for (const field of fields) {
    for (const segment of field.replace(/\[\]/g, "").split(".")) {
      if (!word(segment).test(source)) problems.push(`${name}: \`${field}\` is frozen, and ${file} no longer has \`${segment}\``);
    }
  }
  return problems;
}

function shapeProblems(text: string): string[] {
  const problems: string[] = [];
  const all = [...shapes(part(text, "Shapes")), ...shapes(part(text, "Webhooks"))];
  if (all.length < 20) problems.push(`only ${all.length} shapes were found in docs/api-frozen.md`);
  for (const shape of all) {
    if (!shape.file) {
      problems.push(`${shape.name}: say where it is built ("Built by \`fn\` in \`file\`" or "Built in \`file\`")`);
      continue;
    }
    if (shape.fields.length === 0) problems.push(`${shape.name}: no fields`);
    if (shape.by) {
      const build = BUILDERS[shape.by];
      if (!build) problems.push(`${shape.name}: test/api-frozen.test.ts does not know how to build ${shape.by}`);
      else problems.push(...builtProblems(shape.name, build(), shape.fields));
    } else {
      problems.push(...sourceProblems(shape.name, shape.file, shape.fields));
    }
  }
  return problems;
}

/* ── The values ─────────────────────────────────────────────────── */

const SCHEMA = read("web/prisma/schema.prisma");

function prismaEnum(name: string): string[] {
  const body = new RegExp(`\\nenum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));
}

/** The string literals of whatever a pattern finds in a file. */
function literals(file: string, pattern: RegExp): string[] {
  const found = pattern.exec(read(file))?.[1] ?? "";
  return [...found.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

const sources = (): string => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(readFileSync(full, "utf8"));
    }
  };
  walk(path.join(WEB, "src"));
  return out.join("\n");
};

/* Where each enumeration's values are, in the code. A row on the page with no entry here fails: say where its values come from. */
const VALUES: Record<string, () => string[]> = {
  "server.state": () => prismaEnum("ServerState"),
  "node.state": () => prismaEnum("NodeState"),
  runtime: () => prismaEnum("RuntimeKind"),
  restartPolicy: () => prismaEnum("RestartPolicy"),
  // LOCKED is how the row keeps a lock; the API says COMPLETE and `locked: true` (_shape.ts).
  "backup.state": () => prismaEnum("BackupState").filter((s) => s !== "LOCKED"),
  "backup.trigger": () => prismaEnum("BackupTrigger"),
  "backup.store": () => prismaEnum("BackupStore"),
  "task.kind": () => prismaEnum("TaskKind"),
  "task.lastResult": () => prismaEnum("RunResult"),
  "event.tone": () => prismaEnum("EventTone").map((t) => t.toLowerCase()),
  // Each member of the union opens with its kind: `| { kind: "image"; … }`.
  "game.install": () => {
    const union = /export type InstallStrategy =([\s\S]*?)\n\n/.exec(read("web/src/domain/games/types.ts"))?.[1] ?? "";
    return [...union.matchAll(/\|\s*\{\s*kind:\s*"([^"]+)"/g)].map((m) => m[1]!);
  },
  "version.channel": () => literals("web/src/domain/games/types.ts", /export type VersionChannel =([^;]+);/),
  "dns.state": () => literals("web/src/domain/dns/rules.ts", /export type DnsState =([^;]+);/),
  "dns.records[].type": () => literals("web/src/domain/dns/rules.ts", /export type RecordKind =([^;]+);/),
  "entry.kind": () => literals("web/src/lib/daemon-client.ts", /interface FileEntry \{[^}]*?kind:([^;]+);/),
  "plan.changes[].applies": () => literals("web/src/domain/games/config.ts", /interface ConfigChange \{[\s\S]*?applies:([^;]+);/),
  range: () => Object.keys(RANGE_SECONDS),
  // The notifier's own two besides the audit rows it reads: the test message, and the one that says some were held back.
  "notification.event": () => [...ALL_KINDS, ...new Set([...sources().matchAll(/kind: "(notifications\.[a-z.]+)"/g)].map((m) => m[1]!))],
  "notification.tone": () => literals("web/src/domain/notify/format.ts", /export type NotificationTone =([^;]+);/),
  "dns.event": () => [...WEBHOOK_EVENTS],
};

function valueProblems(text: string): string[] {
  const problems: string[] = [];
  const listed = rows(part(text, "Values"));
  if (listed.length < 15) problems.push(`only ${listed.length} enumerations were found in docs/api-frozen.md`);
  for (const cells of listed) {
    const name = ticks(cells[0]!)[0]!;
    const source = VALUES[name];
    if (!source) {
      problems.push(`${name}: test/api-frozen.test.ts does not know where its values are`);
      continue;
    }
    const frozen = ticks(cells[1] ?? "");
    const code = source();
    if (code.length === 0) problems.push(`${name}: no values were found in the code`);
    for (const value of frozen) if (!code.includes(value)) problems.push(`${name}: \`${value}\` is frozen, and the code no longer has it`);
    for (const value of code) if (!frozen.includes(value)) problems.push(`${name}: the code has \`${value}\`, which docs/api-frozen.md does not list`);
  }
  return problems;
}

/* ── Scopes, error statuses, and the names kept from before ─────── */

function scopeProblems(text: string): string[] {
  const table = /\| Scope \| Grants \| Routes \|[\s\S]*?(?=\n\n)/.exec(text)?.[0] ?? "";
  const listed = rows(table).map((cells) => ({ scope: ticks(cells[0]!)[0]!, grants: ticks(cells[1] ?? "").filter((t) => /^[a-z]+(\.[a-z]+)+$/.test(t)) }));
  const problems: string[] = [];
  if (listed.length < 5) problems.push("the table of scopes was not found in docs/api.md");
  for (const { scope, grants } of listed) {
    const code = SCOPE_PERMISSIONS[scope];
    if (!code) {
      problems.push(`${scope}: in docs/api.md, and no key can hold it`);
      continue;
    }
    if ([...grants].sort().join() !== [...code].sort().join()) problems.push(`${scope}: grants ${code.join(", ")}, and docs/api.md says ${grants.join(", ")}`);
  }
  for (const scope of Object.keys(SCOPE_PERMISSIONS)) if (!listed.some((l) => l.scope === scope)) problems.push(`${scope}: a scope docs/api.md does not list`);
  return problems;
}

function statusProblems(text: string): string[] {
  const table = /\| Code \| Status \|[\s\S]*?(?=\n\n)/.exec(text)?.[0] ?? "";
  const problems: string[] = [];
  for (const cells of rows(table)) {
    const status = Number(/\d{3}/.exec(cells[1] ?? "")?.[0]);
    for (const code of ticks(cells[0]!)) {
      if (!(code in STATUS)) problems.push(`${code}: in the error table, and not a code`);
      else if (STATUS[code as ErrorCode] !== status) problems.push(`${code}: answers ${STATUS[code as ErrorCode]}, and the error table says ${status}`);
    }
  }
  return problems;
}

function deprecatedProblems(text: string): string[] {
  const problems: string[] = [];
  const listed = rows(part(text, "Deprecated"));
  if (listed.length === 0) problems.push("the table of deprecated names was not found");
  for (const cells of listed) {
    const old = ticks(cells[0]!)[0]!;
    const file = ticks(cells[3] ?? "")[0];
    if (!file || !existsSync(path.join(ROOT, file))) {
      problems.push(`${old}: say which file still reads it`);
      continue;
    }
    if (!word(old).test(read(file))) problems.push(`${old}: kept until 2.0, and ${file} no longer has it`);
  }
  return problems;
}

/* ── The tests ──────────────────────────────────────────────────── */

test("every handler under /api/v1 is frozen in docs/api-frozen.md, with the names it takes and answers with", () => {
  assert.deepEqual(routeProblems(FROZEN), []);
});

test("every shape sends exactly the fields docs/api-frozen.md freezes", () => {
  assert.deepEqual(shapeProblems(FROZEN), []);
});

test("every enumeration has exactly the values docs/api-frozen.md freezes", () => {
  assert.deepEqual(valueProblems(FROZEN), []);
});

test("every scope grants what docs/api.md says, and every error code answers with the status it says", () => {
  assert.deepEqual(scopeProblems(API_DOC), []);
  assert.deepEqual(statusProblems(API_DOC), []);
});

test("every name renamed in 0.11 is still read where docs/api-frozen.md says", () => {
  assert.deepEqual(deprecatedProblems(FROZEN), []);
});

/* The checks above pass on the page as it is. These show that each of them fails on the change it is there for. */
test("renaming or removing a frozen name fails", () => {
  const swap = (from: string, to: string) => {
    assert.ok(FROZEN.includes(from), `the page no longer has ${from}`);
    return FROZEN.replace(from, to);
  };
  // A field renamed on the page is a field the shape does not send, and one it sends that is not listed.
  const renamed = shapeProblems(swap("| `resources.memoryGb` | number |", "| `resources.memoryGiB` | number |"));
  assert.ok(renamed.some((p) => p.includes("`resources.memoryGiB` is frozen")), renamed.join("\n"));
  assert.ok(renamed.some((p) => p.includes("sends `resources.memoryGb`")), renamed.join("\n"));
  // A field inside a route's file.
  assert.ok(shapeProblems(swap("| `committed.cpuTotalPct` |", "| `committed.cpuTotal` |")).some((p) => p.includes("cpuTotal`")));
  // A webhook's field.
  assert.ok(shapeProblems(swap("| `sentAt` | time |\n\n### dns.test", "| `sentOn` | time |\n\n### dns.test")).some((p) => p.includes("sentOn")));
  // A name a route takes, and a route that is gone.
  assert.ok(routeProblems(swap("`server`, `rebuildRequired`, `message`", "`server`, `rebuildNeeded`, `message`")).some((p) => p.includes("rebuildNeeded")));
  assert.ok(routeProblems(swap("| `POST /api/v1/tasks/:id/toggle` |", "| `POST /api/v1/tasks/:id/flip` |")).some((p) => p.includes("/tasks/:id/flip: frozen")));
  assert.ok(routeProblems(swap("| `POST /api/v1/tasks/:id/toggle` |", "| `POST /api/v1/tasks/:id/flip` |")).some((p) => p.includes("POST /tasks/:id/toggle: a handler with no row")));
  // A value.
  assert.ok(valueProblems(swap("`ON_FAILURE`, `ALWAYS`", "`ON_CRASH`, `ALWAYS`")).some((p) => p.includes("`ON_CRASH` is frozen")));
  // A name kept from before.
  assert.ok(deprecatedProblems(swap("| `nodeName` |", "| `nodeLabel` |")).some((p) => p.includes("nodeLabel")));
});

test("a scope that grants something else, and a code with another status, fail", () => {
  const scopes = API_DOC.replace("| `servers:monitor` | `server.read` |", "| `servers:monitor` | `server.read`, `node.read` |");
  assert.ok(scopeProblems(scopes).some((p) => p.startsWith("servers:monitor: grants")));
  const statuses = API_DOC.replace("| `RATE_LIMITED` | 429 |", "| `RATE_LIMITED` | 503 |");
  assert.ok(statusProblems(statuses).some((p) => p.startsWith("RATE_LIMITED: answers 429")));
});
