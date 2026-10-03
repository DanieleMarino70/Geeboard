import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

/* `npm run manifest:check` is how somebody who is not running a panel — a person writing a manifest, or the CI of a
   repository that collects them — asks the panel's own checker. It is run here as the process it is, since its exit
   status and what it prints are what they depend on. */

const web = path.join(import.meta.dirname, "..");
const page = readFileSync(path.join(web, "..", "docs", "community-games.md"), "utf8").replace(/\r\n/g, "\n");
const example = /### A real example[\s\S]*?```json\n([\s\S]*?)\n```/.exec(page)![1]!;

function check(args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-manifest.mts", ...args], { cwd: web, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "gb-manifest-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a manifest that passes exits 0, and says which game, which image and which hash", () => {
  const w = workspace();
  try {
    const file = path.join(w.dir, "manifest.json");
    writeFileSync(file, example);
    const r = check([file]);
    assert.equal(r.status, 0, r.out + r.err);
    assert.match(r.out, /community-factorio/);
    assert.match(r.out, /docker\.io\/factoriotools\/factorio@sha256:[0-9a-f]{64}/);
    assert.match(r.out, /sha256 [0-9a-f]{64}/);
    assert.match(r.out, /1 of 1 manifest passed/);
  } finally {
    w.done();
  }
});

test("one that does not exits 1 and names the field that is wrong", () => {
  const w = workspace();
  try {
    const bad = JSON.parse(example);
    bad.privileged = true;
    bad.versions[0].image = "docker.io/factoriotools/factorio:stable";
    const file = path.join(w.dir, "manifest.json");
    writeFileSync(file, JSON.stringify(bad));
    const r = check([file]);
    assert.equal(r.status, 1, r.out + r.err);
    assert.match(r.out, /FAIL/);
    assert.match(r.out, /privileged/);
    assert.match(r.out, /versions\[0\]\.image/);
    assert.match(r.out, /digest/);
  } finally {
    w.done();
  }
});

test("a directory is searched for every manifest.json, and one bad one fails the lot", () => {
  const w = workspace();
  try {
    mkdirSync(path.join(w.dir, "games", "one"), { recursive: true });
    mkdirSync(path.join(w.dir, "games", "two"), { recursive: true });
    mkdirSync(path.join(w.dir, "games", "node_modules", "x"), { recursive: true });
    writeFileSync(path.join(w.dir, "games", "one", "manifest.json"), example);
    writeFileSync(path.join(w.dir, "games", "two", "manifest.json"), "{ not json");
    writeFileSync(path.join(w.dir, "games", "node_modules", "x", "manifest.json"), "{ ignored");
    const r = check([path.join(w.dir, "games")]);
    assert.equal(r.status, 1);
    assert.match(r.out, /1 of 2 manifests passed, 1 did not/);
    assert.ok(!r.out.includes("node_modules"), "a vendored folder is not looked into");
  } finally {
    w.done();
  }
});

test("a registry that is not the default is refused until --registries allows it", () => {
  const w = workspace();
  try {
    const manifest = JSON.parse(example);
    manifest.versions[0].image = `quay.io/someone/factorio@sha256:${"ab".repeat(32)}`;
    const file = path.join(w.dir, "manifest.json");
    writeFileSync(file, JSON.stringify(manifest));
    assert.equal(check([file]).status, 1);
    assert.equal(check([file, "--registries", "docker.io,ghcr.io,quay.io"]).status, 0);
  } finally {
    w.done();
  }
});

test("--json prints one array a script can read", () => {
  const w = workspace();
  try {
    const file = path.join(w.dir, "manifest.json");
    writeFileSync(file, example);
    const r = check([file, "--json"]);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.out) as Array<{ ok: boolean; id: string; hash: string }>;
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.ok, true);
    assert.equal(parsed[0]!.id, "community-factorio");
    assert.match(parsed[0]!.hash, /^[0-9a-f]{64}$/);
  } finally {
    w.done();
  }
});

test("nothing to check, a missing path and an unknown option are exit 2, not a pass", () => {
  assert.equal(check([]).status, 2);
  assert.equal(check([path.join(tmpdir(), "gb-does-not-exist-manifest.json")]).status, 2);
  assert.equal(check(["--nope", "x"]).status, 2);
  const w = workspace();
  try {
    assert.equal(check([w.dir]).status, 2, "an empty directory is not a passing run");
  } finally {
    w.done();
  }
});
