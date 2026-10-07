import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { RESERVED_FAMILIES, RESERVED_PORTS } from "../src/domain/games/manifest.ts";
import { PARKED, allGames } from "../src/domain/games/registry.ts";
import type { GameDefinition } from "../src/domain/games/types.ts";
import { SCOPE_PERMISSIONS } from "../src/domain/access/permissions.ts";
import { MEASURED_CAPABILITIES } from "../src/lib/agent-command.ts";

/* Places where something is written down twice, and one of the two is a hand copy. Each of these is a test that fails the day a game, a
   scope, a measured capability or a port is added in one place and not the other, and says which. The panel's claim that a game is data and
   a line in the registry is only as strong as the places that would notice a forgotten line. */

const WEB = path.join(import.meta.dirname, "..");
const REPO = path.join(WEB, "..");

test("every definition file is a game the registry offers or one it says it has parked, and passes its own audit", async () => {
  const dir = path.join(WEB, "src", "domain", "games", "definitions");
  const offered = new Set(allGames().map((g) => g.id));
  const found: GameDefinition[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const loaded = (await import(pathToFileURL(path.join(dir, file)).href)) as Record<string, unknown>;
    const defined = Object.values(loaded).filter((v): v is GameDefinition => typeof v === "object" && v !== null && "versions" in v && "ports" in v && "id" in v);
    assert.ok(defined.length > 0, `${file} exports no game definition`);
    found.push(...defined);
  }
  for (const game of found) {
    assert.ok(offered.has(game.id) || PARKED.includes(game.id), `${game.id} has a definition file and is neither registered nor parked: add it to DEFINITIONS in registry.ts, or to PARKED with the note of what has to be measured first`);
    assert.deepEqual(auditDefinition(game), [], game.id);
    assert.ok(RESERVED_FAMILIES.includes(game.family.toLowerCase()), `${game.id}'s family "${game.family}" is not in RESERVED_FAMILIES: a community game could take its name`);
  }
  for (const id of PARKED) assert.ok(found.some((g) => g.id === id), `${id} is parked and has no definition file`);
});

test("a definition that declares what the panel cannot write is refused by the audit, with the sentence the manifest gives", () => {
  const base = allGames()[0]!;
  const json = { ...base, config: [{ ...base.config[0]!, target: { kind: "json", file: "x.json", pointer: "/a" } }] } as unknown as GameDefinition;
  assert.ok(auditDefinition(json).some((p) => /targets a JSON file/.test(p)));
  const download = { ...base, install: { kind: "download", archive: "zip" } } as unknown as GameDefinition;
  assert.ok(auditDefinition(download).some((p) => /installs from a download/.test(p)));
  // And the manifest refuses the same two, so the import audit and the manifest say one thing.
  const manifest = readFileSync(path.join(WEB, "src", "domain", "games", "manifest.ts"), "utf8");
  assert.match(manifest, /json is not a kind the panel can write yet/);
  assert.match(manifest, /kind !== "image"|download/);
});

test("the capabilities the panel will not let an operator claim are the ones the agent measures", () => {
  const agent = readFileSync(path.join(REPO, "daemon", "src", "capabilities.ts"), "utf8");
  const body = /export async function capabilities\([\s\S]*?\n\}/.exec(agent)?.[0] ?? "";
  const measured = [...body.matchAll(/found\.add\("([\w-]+)"\)/g)].map((m) => m[1]!).sort();
  assert.deepEqual([...MEASURED_CAPABILITIES].sort(), measured, "lib/agent-command.ts MEASURED_CAPABILITIES and daemon/src/capabilities.ts disagree: an operator would be offered a checkbox for what the agent measures");
});

test("the ports the panel will not give a game include the agent's own default", () => {
  const config = readFileSync(path.join(REPO, "daemon", "src", "config.ts"), "utf8");
  const agentPort = Number(/"GEEBOARD_DAEMON_PORT", joined\?\.port \?\? (\d+)/.exec(config)?.[1]);
  assert.ok(Number.isInteger(agentPort), "the agent's default port was not found in daemon/src/config.ts");
  assert.ok(RESERVED_PORTS.includes(agentPort), `the agent listens on ${agentPort} by default and a game's block may include it`);
});

test("an API scope is the same in the key form, the permission table and the documentation", () => {
  const ops = readFileSync(path.join(WEB, "src", "lib", "server-ops.ts"), "utf8");
  const form = [...(/export const API_SCOPES = \[([\s\S]*?)\] as const;/.exec(ops)?.[1] ?? "").matchAll(/id: "([\w:]+)"/g)].map((m) => m[1]!).sort();
  const table = Object.keys(SCOPE_PERMISSIONS).sort();
  assert.deepEqual(form, table, "API_SCOPES (lib/server-ops.ts) and SCOPE_PERMISSIONS (domain/access/permissions.ts) disagree");

  const docs = readFileSync(path.join(REPO, "docs", "api.md"), "utf8");
  const rows = [...docs.matchAll(/^\| `([a-z]+:[a-z]+)` \| (.+?) \| /gm)];
  assert.deepEqual(rows.map((r) => r[1]!).sort(), table, "docs/api.md's scope table lists a scope the code does not have, or lacks one it has");
  for (const [, scope, grants] of rows) {
    const named = [...grants!.matchAll(/`([a-z]+\.[a-z.]+)`/g)].map((m) => m[1]!).sort();
    // A row that names permissions names exactly the ones the table gives it; one that describes them in words is not compared.
    if (named.length > 0) assert.deepEqual(named, [...SCOPE_PERMISSIONS[scope!]!].sort(), `${scope} in docs/api.md`);
  }
});

test("the panel says who it is in one place: no client writes a user agent of its own", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, name.name);
      if (name.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name.name) && !file.endsWith(path.join("net", "user-agent.ts"))) {
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (/["']user-agent["']\s*:/i.test(line) && !/userAgent\(\)|USER_AGENT|h\.get\("user-agent"\)|headers\.get/.test(line)) offenders.push(`${path.relative(WEB, file)}:${i + 1}`);
          });
      }
    }
  };
  walk(path.join(WEB, "src"));
  assert.deepEqual(offenders, [], "use userAgent() from @/domain/net/user-agent");
});
