import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_REGISTRIES } from "../src/domain/games/image-ref.ts";
import { MAX_MANIFEST_CHARS, RESERVED_FAMILIES, RESERVED_PORTS, validateManifest } from "../src/domain/games/manifest.ts";

/* docs/community-games.md says what the rules are and gives a manifest that passes them. A page that was true when it
   was written and is not now is worse than no page, so the page is held to the code: the example is validated, and
   every number and name the rules table gives is read back from where the code keeps it. */

const root = path.join(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const page = read("docs", "community-games.md");

test("the example manifest in the page passes the checker, with the registries a workspace starts with", () => {
  const block = /## A real example|### A real example/.exec(page);
  assert.ok(block, "the page has its example");
  const after = page.slice(block.index);
  const json = /```json\n([\s\S]*?)\n```/.exec(after);
  assert.ok(json, "and it is a json block");
  const result = validateManifest(json[1]!, { registries: DEFAULT_REGISTRIES });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems));
  assert.equal(result.definition.id, "community-factorio");
  assert.equal(result.definition.official, false);
  assert.ok(result.definition.requirements.capabilities.includes("community-games"));
  assert.ok(result.images.every((i) => i.canonical.startsWith("docker.io/")));
});

test("the page names every port the checker reserves, every family it protects and the registries it starts with", () => {
  for (const port of RESERVED_PORTS) assert.ok(new RegExp(`\\b${port}\\b`).test(page), `port ${port}`);
  for (const family of RESERVED_FAMILIES) assert.ok(page.toLowerCase().includes(family), `family ${family}`);
  for (const host of DEFAULT_REGISTRIES) assert.ok(page.includes(host), `registry ${host}`);
  assert.ok(page.includes(`${MAX_MANIFEST_CHARS / 1024} KB`));
});

test("the page and the installers agree on the two flags that declare the capability", () => {
  assert.ok(page.includes("--community-games") && page.includes("-CommunityGames"));
  assert.ok(read("deploy", "linux", "install.sh").includes("--community-games)"));
  assert.ok(/\[switch\]\$CommunityGames/.test(read("deploy", "windows", "install-node.ps1")));
});

test("the firewall the page describes is the script that is shipped: the same three rules and the same comment", () => {
  const script = read("deploy", "linux", "container-firewall.sh");
  assert.ok(script.includes("169.254.169.254/32") && /-i docker0/.test(script) && /-i br-\+/.test(script));
  assert.ok(script.includes("geeboard-container-firewall") && page.includes("geeboard-container-firewall"));
  assert.ok(page.includes("DOCKER-USER") && page.includes("`INPUT`"));
  // The unit the page shows calls the script by the name the page installs it under.
  assert.ok(page.includes("/usr/local/sbin/geeboard-container-firewall add") && page.includes("install -m 0755 deploy/linux/container-firewall.sh /usr/local/sbin/geeboard-container-firewall"));
});
