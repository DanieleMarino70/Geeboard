import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import * as lib from "../../scripts/release-lib.mjs";

/* A release edits about eight files by hand, and until this nothing held them to each other: the tag was compared with two package.json files
   and a version in a lock file, a line of the install pages or the changelog's heading could say another, and the first symptom was somebody
   following a stale tag. scripts/release-lib.mjs is those checks, and `bump`, which writes what is mechanical. This runs it on the real tree
   (so a skew cannot reach a branch, not only a tag), and on copies of it with one thing made wrong each, which must name the file. */

const REPO = path.join(import.meta.dirname, "..", "..");

interface Problem {
  file: string;
  message: string;
}

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/* The files a release is made of, copied into a directory of their own, so that a test can break one and the real tree is never touched. */
function copyOfTree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gb-release-"));
  made.push(dir);
  const files = ["README.md", "CHANGELOG.md", "web/package.json", "web/package-lock.json", "daemon/package.json", "daemon/package-lock.json", "web/src/domain/nodes/agent-version.ts", "daemon/src/contract.ts", "web/test/migrations-pinned.json"];
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    cpSync(path.join(REPO, file), path.join(dir, file));
  }
  cpSync(path.join(REPO, "docs"), path.join(dir, "docs"), { recursive: true });
  mkdirSync(path.join(dir, "web", "prisma"), { recursive: true });
  cpSync(path.join(REPO, "web", "prisma", "migrations"), path.join(dir, "web", "prisma", "migrations"), { recursive: true });
  return dir;
}
const text = (dir: string, file: string) => readFileSync(path.join(dir, file), "utf8").split("\r\n").join("\n");
const rewrite = (dir: string, file: string, change: (text: string) => string) => {
  const before = text(dir, file);
  const after = change(before);
  assert.notEqual(after, before, `the change to ${file} changed nothing: the test is wrong`);
  writeFileSync(path.join(dir, file), after);
};
const names = (problems: Problem[]) => problems.map((p) => p.file).sort();

/* The prose a person writes at a cut, which bump cannot: the section is no longer a draft, and the roadmap says where it is explained. */
function writeTheProse(dir: string, version: string) {
  const [major, minor] = version.split(".");
  rewrite(dir, "CHANGELOG.md", (t) => t.replace(/^\*Work in progress[^\n]*\n\n?/m, ""));
  const roadmap = text(dir, "docs/roadmap.md");
  if (!new RegExp(`^#{2,3} .*\\(${major}\\.${minor}\\.0\\)`, "m").test(roadmap)) rewrite(dir, "docs/roadmap.md", (t) => `${t.trimEnd()}\n\n### The release (${major}.${minor}.0)\n\nWhat it was.\n`);
}

test("the tree says one release everywhere: the packages, the locks, the pages, the changelog, the contract", () => {
  assert.deepEqual(lib.consistency(REPO), [], "a release is made of about eight files that say its version; one of them says another");
});

test("a lock file that says another version than its package is named", () => {
  const dir = copyOfTree();
  rewrite(dir, "web/package-lock.json", (t) => t.replace(/^(\{\n {2}"name": "web",\n {2}"version": ")[^"]+/, "$19.9.9"));
  assert.deepEqual(names(lib.consistency(dir)), ["web/package-lock.json"]);
  const second = copyOfTree();
  rewrite(second, "daemon/package-lock.json", (t) => t.replace(/^( {4}"": \{\n {6}"name": "[^"]+",\n {6}"version": ")[^"]+/m, "$19.9.9"));
  assert.deepEqual(names(lib.consistency(second)), ["daemon/package-lock.json"]);
});

test("the agent's package that says another version than the panel's is named", () => {
  const dir = copyOfTree();
  rewrite(dir, "daemon/package.json", (t) => t.replace(/("version":\s*")[^"]+/, "$10.0.1"));
  assert.ok(names(lib.consistency(dir)).includes("daemon/package.json"));
});

test("an install page that names an image or a checkout that is not this release is named", () => {
  const dir = copyOfTree();
  rewrite(dir, "docs/upgrading.md", (t) => t.replace(/geeboard-panel:\d+\.\d+\.\d+/, "geeboard-panel:0.0.1"));
  assert.deepEqual(names(lib.consistency(dir)), ["docs/upgrading.md"]);
  const second = copyOfTree();
  rewrite(second, "docs/nodes.md", (t) => t.replace(/--branch v\d+\.\d+\.\d+/, "--branch v0.0.1"));
  assert.deepEqual(names(lib.consistency(second)), ["docs/nodes.md"]);
});

test("a clone of the default branch is named, because it is ahead of the last release", () => {
  const dir = copyOfTree();
  rewrite(dir, "README.md", (t) => t.replace(/git clone --branch stable /, "git clone "));
  assert.deepEqual(names(lib.consistency(dir)), ["README.md"]);
});

test("a changelog link that was dropped, and a heading that is not the release, are named", () => {
  const dir = copyOfTree();
  rewrite(dir, "CHANGELOG.md", (t) => t.replace(/^\[0\.8\.1\]: .*\n/m, ""));
  assert.deepEqual(names(lib.consistency(dir)), ["CHANGELOG.md"]);
  assert.match(lib.consistency(dir)[0]!.message, /0\.8\.1/);
});

test("a contract the changelog does not agree with the code about is named", () => {
  const dir = copyOfTree();
  rewrite(dir, "daemon/src/contract.ts", (t) => t.replace(/export const AGENT_CONTRACT = \d+/, "export const AGENT_CONTRACT = 2"));
  assert.deepEqual(names(lib.consistency(dir)), ["CHANGELOG.md"]);
});

test("bump writes everything that is mechanical, and what it leaves is exactly the prose", () => {
  const dir = copyOfTree();
  const changed = lib.bump(dir, "0.9.0", { date: "2026-10-09" });
  for (const file of ["web/package.json", "web/package-lock.json", "daemon/package.json", "daemon/package-lock.json", "CHANGELOG.md", "web/test/migrations-pinned.json"]) assert.ok(changed.includes(file), `${file} was not written`);

  const lock = JSON.parse(text(dir, "web/package-lock.json")) as { version: string; packages: Record<string, { version?: string }> };
  assert.equal(lock.version, "0.9.0");
  assert.equal(lock.packages[""]!.version, "0.9.0");
  assert.equal(JSON.parse(text(dir, "web/package.json")).version, "0.9.0");
  assert.match(text(dir, "CHANGELOG.md"), /^## \[0\.9\.0\] — 2026-10-09$/m);
  assert.match(text(dir, "CHANGELOG.md"), /^\[0\.9\.0\]: https:\/\/github\.com\/DanieleMarino70\/Geeboard\/releases\/tag\/v0\.9\.0$/m);
  assert.doesNotMatch(text(dir, "CHANGELOG.md"), /^\[Unreleased\]: /m);
  assert.doesNotMatch(text(dir, "docs/upgrading.md"), /geeboard-panel:0\.8\.1/);

  // The two things only a person can write: that the section is no longer a draft, and the roadmap's entry.
  const left = lib.consistency(dir);
  assert.deepEqual(names(left).sort(), ["CHANGELOG.md", ...(left.some((p) => p.file === "docs/roadmap.md") ? ["docs/roadmap.md"] : [])].sort());
  assert.ok(left.some((p) => /work in progress/.test(p.message)));
  writeTheProse(dir, "0.9.0");
  assert.deepEqual(lib.consistency(dir), []);

  // The pins are of the migrations this release ships, and bumping again changes nothing.
  assert.deepEqual(Object.keys(JSON.parse(text(dir, "web/test/migrations-pinned.json")).migrations), Object.keys(lib.pinMigrations(dir)));
  assert.deepEqual(lib.bump(dir, "0.9.0", { date: "2026-10-09" }), []);
});

test("a release after it takes a skeleton, and a changelog out of order is named", () => {
  const dir = copyOfTree();
  lib.bump(dir, "0.9.0", { date: "2026-10-09" });
  writeTheProse(dir, "0.9.0");
  lib.bump(dir, "0.9.1", { date: "2026-10-12" });
  assert.match(text(dir, "CHANGELOG.md"), /^## \[0\.9\.1\] — 2026-10-12\n\n\*\*Agent contract: 1, unchanged\.\*\*/m);
  assert.deepEqual(lib.consistency(dir), []);

  rewrite(dir, "CHANGELOG.md", (t) => t.replace("## [0.9.1] — 2026-10-12", "## [0.9.1] — 2026-10-01"));
  assert.deepEqual(names(lib.consistency(dir)), ["CHANGELOG.md"]);
  assert.match(lib.consistency(dir)[0]!.message, /2026-10-01/);
});

test("the unreleased section has to be the version it is cut as", () => {
  const dir = copyOfTree();
  assert.throws(() => lib.bump(dir, "0.9.7"), /0\.9\.0/);
  assert.throws(() => lib.bump(dir, "nine"), /not a version/);
});

test("the pins are of migrations that are there, in the order they were made", () => {
  const dir = path.join(REPO, "web", "prisma", "migrations");
  const present = readdirSync(dir).filter((name) => existsSync(path.join(dir, name, "migration.sql")));
  assert.ok(present.length > 40);
  assert.deepEqual(Object.keys(lib.pinMigrations(REPO)), [...present].sort());
});
