import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* A setting that docs/advanced-install.md tells a person to put in deploy/panel/.env, and that deploy/panel/docker-compose.yml does not hand
   on to the containers, is a setting that reaches nothing: the file looks edited and the panel behaves as it did. That is what happened to
   the update check's off switch before this test — the audit of 0.9.5 found a variable that was documented, read by the poller, and never passed.
   Every variable the page documents is named in the compose file as one it substitutes. */

const REPO = path.join(import.meta.dirname, "..", "..");
const page = readFileSync(path.join(REPO, "docs", "advanced-install.md"), "utf8").split("\r\n").join("\n");
const compose = readFileSync(path.join(REPO, "deploy", "panel", "docker-compose.yml"), "utf8").split("\r\n").join("\n");

test("every variable the install page documents for the panel's .env is one the compose file substitutes", () => {
  const rows = [...page.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]!);
  assert.ok(rows.length >= 8, `the table has ${rows.length} rows: the pattern missed it`);
  const missing = rows.filter((name) => !compose.includes(`\${${name}`));
  assert.deepEqual(missing, [], "documented in docs/advanced-install.md, absent from deploy/panel/docker-compose.yml");
});

test("the update check's two settings reach the panel and the poller, which share one environment", () => {
  const block = compose.slice(compose.indexOf("environment: &panel-env"), compose.indexOf("ports:", compose.indexOf("environment: &panel-env")));
  for (const name of ["GEEBOARD_UPDATE_CHECK", "GEEBOARD_UPDATE_URL"]) assert.match(block, new RegExp(`${name}: \\$\\{${name}:-\\}`), name);
  assert.ok(/environment: \*panel-env/.test(compose), "the poller does not reuse the panel's environment");
});
