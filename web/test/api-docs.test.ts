import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STATUS } from "../src/domain/errors.ts";

/* docs/api.md is the contract of /api/v1, and it was written by hand. It listed codes no route sends, showed a response no route produces, and
   was silent about routes that exist. This reads the handlers and the page and fails where they part: a handler the page does not name, a code
   in its table that nothing can send, a code a route can send that the table does not list. No database, no browser: files. */

const WEB = path.join(import.meta.dirname, "..");
const API = path.join(WEB, "src", "app", "api", "v1");
// LF, whatever the checkout's line endings are: a Windows checkout with autocrlf has the table in CRLF, and the test looked for a newline.
const DOCS = readFileSync(path.join(WEB, "..", "docs", "api.md"), "utf8").split("\r\n").join("\n");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface Handler {
  method: string;
  route: string; // "/servers/:id/start"
  file: string;
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
        for (const method of METHODS) {
          if (new RegExp(`export (?:async )?function ${method}\\b`).test(source)) out.push({ method, route: route === "/" ? "/" : route, file: path.relative(WEB, full) });
        }
      }
    }
  };
  walk(API);
  return out;
}

/* What the page names, expanded the way it is written, in the order it is written:
     `GET` · `POST /api/v1/servers/:id/tasks`   methods first, then the path they share
     `POST /api/v1/nodes/:name/drain` · `/approve`   a sibling of the path before it
     `POST …/run` · `/toggle`   an ellipsis for the part that is already known, and a sibling of that
   A method and a path at a time. */
function documented(text: string): { exact: Set<string>; suffix: Array<{ method: string; tail: string }> } {
  const exact = new Set<string>();
  const suffix: Array<{ method: string; tail: string }> = [];
  let methods: string[] = [];
  let method = "GET";
  let base = "";
  let relative = false;
  for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
    let item = raw!.trim();
    if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(item)) {
      methods.push(item);
      continue;
    }
    const withMethod = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/.exec(item);
    if (withMethod) {
      methods.push(withMethod[1]!);
      method = withMethod[1]!;
      item = withMethod[2]!;
    }
    item = item.replace(/[?].*$/, "");
    const these = methods.length > 0 ? methods : [method];
    methods = [];
    if (item.startsWith("…")) {
      for (const m of these) suffix.push({ method: m, tail: item.slice(1) });
      relative = true;
      continue;
    }
    if (item.startsWith("/api/v1/")) {
      base = item.slice("/api/v1".length);
      relative = false;
      for (const m of these) exact.add(`${m} ${base}`);
      continue;
    }
    if (item.startsWith("/api/")) continue;
    // A sibling of the last path, which may itself have been an ellipsis: `/approve` after `/nodes/:name/drain`, `/toggle` after `…/run`.
    if (/^\/[\w:-]+$/.test(item) && (base || relative)) {
      for (const m of these) {
        if (relative) suffix.push({ method: m, tail: item });
        else exact.add(`${m} ${base.replace(/\/[^/]+$/, "")}${item}`);
      }
      continue;
    }
    // Several segments from the parent: `/mods/ask` after `/servers/:id/mods/apply`.
    if (/^\/[\w:/-]+$/.test(item)) for (const m of these) suffix.push({ method: m, tail: item });
  }
  return { exact, suffix };
}

/* The handlers a page does not name. A function of the page, so that the check can be shown to fail. */
function unnamed(text: string): string[] {
  const { exact, suffix } = documented(text);
  const missing: string[] = [];
  for (const h of handlers()) {
    if (exact.has(`${h.method} ${h.route}`)) continue;
    if (suffix.some((s) => s.method === h.method && h.route.endsWith(s.tail))) continue;
    missing.push(`${h.method} ${h.route}  (${h.file})`);
  }
  return missing;
}

/* The codes in the page's table of statuses: a cell may hold several. */
function tabled(text: string): string[] {
  const section = /\| Code \| Status \|[\s\S]*?(?=\n\n)/.exec(text)?.[0] ?? "";
  return [...section.matchAll(/^\|[^\n]*$/gm)].flatMap((row) => [...row[0].matchAll(/`([A-Z][A-Z_]+)`/g)].map((m) => m[1]!));
}

test("every handler under /api/v1 is named in docs/api.md", () => {
  assert.deepEqual(unnamed(DOCS), [], "name each of these in docs/api.md, with what it needs and what it answers");
});

test("the check for a handler the page does not name can fail", () => {
  // A page that names one route leaves every other handler unnamed; a page that names a route that is not there names none.
  assert.ok(unnamed("`GET /api/v1/servers`").length > 40);
  assert.ok(unnamed("`GET /api/v1/servers`").every((line) => !line.startsWith("GET /servers ")));
  assert.equal(unnamed("`GET /api/v1/not-a-route`").length, handlers().length);
});

test("the check for the error table can fail", () => {
  assert.deepEqual(tabled("| Code | Status |\n| --- | --- |\n| `MADE_UP`, `NOT_FOUND` | 404 |\n\nafter"), ["MADE_UP", "NOT_FOUND"]);
  assert.deepEqual(tabled("no table here"), []);
});

test("every code in the error table is one the API can send, and every one it can send is in the table", () => {
  const codes = tabled(DOCS);
  assert.ok(codes.length > 10, "the error table was not found in docs/api.md");

  // Where a code can come from: any source that is not the table of statuses, and not a test or a doc.
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !full.endsWith(path.join("domain", "errors.ts"))) sources.push(readFileSync(full, "utf8"));
    }
  };
  walk(path.join(WEB, "src"));
  const all = sources.join("\n");
  const emittable = Object.keys(STATUS).filter((code) => new RegExp(`["'\`]${code}["'\`]`).test(all));

  // The two that errors.ts itself says: an unforeseen error, and the key a stored secret will not open with.
  const dead = codes.filter((c) => !emittable.includes(c) && c !== "INTERNAL" && c !== "SECRETS_UNREADABLE");
  assert.deepEqual(dead, [], "documented, and nothing sends it: send it, or take it out of the table");
  /* Codes a client can meet that the table does not list: the table is the contract. Not these: the DNS provider's codes and the
     version providers' are what those talk to the panel in, and come back as a record's `error` or an entry of `providerErrors`,
     not as a request's code, and SECRETS_UNREADABLE is in the table already. */
  const unlisted = emittable.filter((c) => !codes.includes(c) && !/^(SECRETS_UNREADABLE|DNS_|VERSION_PROVIDER|GAME_VERSION)/.test(c));
  assert.deepEqual(unlisted, [], "sendable and not documented");
});
