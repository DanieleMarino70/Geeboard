/* eslint-disable @typescript-eslint/no-explicit-any -- a manifest is loose JSON until it is validated, and these tests are the ones that break it */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { allGames } from "../src/domain/games/registry.ts";
import { MINECRAFT_JAVA } from "../src/domain/games/definitions/minecraft-java.ts";
import { PALWORLD } from "../src/domain/games/definitions/palworld.ts";
import { RUST } from "../src/domain/games/definitions/rust.ts";
import { SATISFACTORY } from "../src/domain/games/definitions/satisfactory.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { PROJECT_ZOMBOID } from "../src/domain/games/definitions/project-zomboid.ts";
import { VALHEIM } from "../src/domain/games/definitions/valheim.ts";
import { MINECRAFT_BEDROCK } from "../src/domain/games/definitions/minecraft-bedrock.ts";
import {
  MAX_MANIFEST_CHARS,
  RESERVED_FAMILIES,
  canonicalJson,
  hashOf,
  validateManifest,
  type ManifestProblem,
} from "../src/domain/games/manifest.ts";
import type { GameDefinition } from "../src/domain/games/types.ts";

/* A game somebody else wrote. Every rule has a manifest that breaks it, and
   the games Geeboard ships — turned into manifests — are accepted, which is
   the proof the rules are not stricter than the format. */

const ALL: GameDefinition[] = [MINECRAFT_JAVA, MINECRAFT_BEDROCK, TERRARIA, PROJECT_ZOMBOID, VALHEIM, RUST, PALWORLD, SATISFACTORY];

const digestOf = (image: string) => `sha256:${createHash("sha256").update(image).digest("hex")}`;
const pinned = (image: string) => `${image.replace(/@sha256:[a-f0-9]{64}$/, "")}@${digestOf(image)}`;

/* What an author would write for a game Geeboard already has: the same definition, in JSON, with what a manifest
   does not carry taken out and what it requires put in. */
function asManifest(def: GameDefinition): Record<string, any> {
  const m = JSON.parse(JSON.stringify(def)) as Record<string, any>;
  m.manifest = 1;
  m.id = `community-${def.id}`;
  m.family = `${def.family} Community`;
  delete m.official;
  delete m.mods;
  delete m.srv;
  delete m.versionSources;
  delete m.followTags;
  m.install ={ kind: "image", ...(def.install.kind !== "download" && def.install.env ? { env: def.install.env } : {}), ...(def.install.kind === "image" && def.install.files ? { files: def.install.files } : {}) };
  m.versions = m.versions.map((v: Record<string, any>) => {
    const rest = { ...v };
    delete rest.steamBranch;
    delete rest.download;
    return { ...rest, image: pinned(String(v.image)) };
  });
  return m;
}

const base = () => asManifest(TERRARIA);
const refusedAt = (manifest: unknown, path: string, message: RegExp, policy = {}): ManifestProblem[] => {
  const result = validateManifest(manifest, policy);
  assert.equal(result.ok, false, `${path}: it was accepted`);
  const problems = result.ok ? [] : result.problems;
  assert.ok(problems.some((p) => p.path === path && message.test(p.message)), `${path} ${message}: got ${JSON.stringify(problems.slice(0, 6))}`);
  return problems;
};

/* ── The games Geeboard ships ─────────────────────────────────── */

test("every game Geeboard ships, as a manifest, is accepted: the rules are not stricter than the format", () => {
  for (const def of allGames()) {
    const result = validateManifest(asManifest(def));
    assert.ok(result.ok, `${def.id}: ${result.ok ? "" : JSON.stringify(result.problems.slice(0, 5))}`);
  }
});

/* The three parked games were never registered, so audit() never read them, and Palworld asked a Source query on a
   port it did not have: found by this very test, fixed in the definition, and now held by definitions-audit.test.ts.
   They are accepted outright, which is the proof the manifest rules are not stricter than the format for any game
   Geeboard has written. */
test("the parked games are accepted too", () => {
  for (const def of [RUST, PALWORLD, SATISFACTORY]) {
    const result = validateManifest(asManifest(def));
    assert.ok(result.ok, `${def.id}: ${result.ok ? "" : JSON.stringify(result.problems.slice(0, 5))}`);
  }
});

test("what comes out is built from what was checked: not official, static versions, the capability added", () => {
  const result = validateManifest(base());
  assert.ok(result.ok);
  const d = result.definition;
  assert.equal(d.official, false);
  assert.deepEqual(d.versionSources, [{ provider: "static" }]);
  assert.equal(d.id, "community-terraria");
  assert.ok(d.requirements.capabilities.includes("docker") && d.requirements.capabilities.includes("community-games"));
  assert.equal(d.install.kind, "image");
  assert.equal(result.images.length, d.versions.length);
  assert.ok(result.images.every((i) => /^docker\.io\/.+@sha256:[a-f0-9]{64}$/.test(i.canonical)));
});

/* A community game's versions are the ones its manifest lists, each pinned by digest. Following an image's tags is how Geeboard's own
   definitions learn of a release without a release of Geeboard, and a tag is a name its maker can move: it is not offered to a manifest. */
test("a manifest cannot follow the tags of its image", () => {
  const m = base();
  m.followTags = { repository: "someone/their-image", lines: [{ line: "", tag: "(?<version>\\d+\\.\\d+)" }] };
  refusedAt(m, "followTags", /not a field a manifest may have/);
});

test("the capability is added even when the author wrote others, and other capabilities are kept", () => {
  const m = base();
  m.requirements.capabilities = ["gpu"];
  const result = validateManifest(m);
  assert.ok(result.ok);
  assert.deepEqual([...result.definition.requirements.capabilities].sort(), ["community-games", "docker", "gpu"]);
  const none = base();
  delete none.requirements.capabilities;
  const r2 = validateManifest(none);
  assert.ok(r2.ok && r2.definition.requirements.capabilities.includes("community-games"));
});

test("the input is not changed, and the result is not the input", () => {
  const m = base();
  const before = JSON.stringify(m);
  const result = validateManifest(m);
  assert.ok(result.ok);
  assert.equal(JSON.stringify(m), before);
  assert.notEqual(result.definition, m);
  assert.notEqual(result.definition.ports, m.ports);
});

test("the families a manifest may not take are every family Geeboard ships, parked ones included", () => {
  for (const def of [...allGames(), ...ALL]) assert.ok(RESERVED_FAMILIES.includes(def.family.toLowerCase()), def.family);
});

/* ── Images ───────────────────────────────────────────────────── */

test("a registry that is not on the list is refused, and the list is the policy's", () => {
  const m = base();
  m.versions[0].image = pinned("quay.io/org/img:1");
  refusedAt(m, "versions[0].image", /quay\.io is not on this workspace's list \(docker\.io, ghcr\.io\)/);
  assert.ok(validateManifest(m, { registries: ["docker.io", "quay.io"] }).ok);
  const lookalike = base();
  lookalike.versions[0].image = pinned("ghcr.io.evil.example/x/y");
  refusedAt(lookalike, "versions[0].image", /not on this workspace's list/);
});

test("an image with no digest is refused, whatever its tag", () => {
  for (const image of ["ryshe/terraria", "ryshe/terraria:latest", "ryshe/terraria:vanilla-1.4.5.8", "ghcr.io/o/r:1.0"]) {
    const m = base();
    m.versions[0].image = image;
    refusedAt(m, "versions[0].image", /no digest/);
  }
});

test("a malformed digest is refused", () => {
  const m = base();
  m.versions[0].image = "ryshe/terraria@sha256:abc";
  refusedAt(m, "versions[0].image", /digest/);
});

test("an image reference that could be a flag, or is not text, is refused", () => {
  const flag = base();
  flag.versions[0].image = `--privileged@${digestOf("x")}`;
  refusedAt(flag, "versions[0].image", /not an image reference/);
  const number = base();
  number.versions[0].image = 5;
  refusedAt(number, "versions[0].image", /has to be text/);
});

/* ── What a manifest may not carry ────────────────────────────── */

test("an install that downloads, or is not an image, is refused", () => {
  const m = base();
  m.install = { kind: "download", archive: "zip" };
  refusedAt(m, "install.kind", /has to be "image"/);
  const steam = base();
  steam.install = { kind: "steamcmd", appId: 1, anonymous: true };
  refusedAt(steam, "install.kind", /has to be "image"/);
});

test("mods, a download and a Steam branch are refused with the reason", () => {
  const mods = base();
  mods.mods = { provider: "steam-workshop", appId: 1 };
  refusedAt(mods, "mods", /cannot carry mods/);
  const download = base();
  download.versions[0].download = { url: "https://example.com/x.zip" };
  refusedAt(download, "versions[0].download", /request the panel would make/);
  const branch = base();
  branch.versions[0].steamBranch = "public";
  refusedAt(branch, "versions[0].steamBranch", /only the static source/);
});

test("an SRV record is refused with the reason: it would write into the owner's own DNS zone", () => {
  const m = base();
  m.srv = { service: "minecraft", protocol: "tcp", port: "game" };
  refusedAt(m, "srv", /cannot ask for an SRV record in this release/);
});

test("a version source other than the static one is refused", () => {
  const m = base();
  m.versionSources = [{ provider: "github", owner: "a", repo: "b" }];
  refusedAt(m, "versionSources", /static/);
  const ok = base();
  ok.versionSources = [{ provider: "static" }];
  assert.ok(validateManifest(ok).ok);
});

test("a game that says it is official, or has an unknown field, or the wrong format version, is refused", () => {
  const official = base();
  official.official = true;
  refusedAt(official, "official", /only the games Geeboard ships/);
  const extra = base();
  extra.sidecar = "x";
  refusedAt(extra, "sidecar", /not a field a manifest may have/);
  const nested = base();
  nested.ports[0].privileged = true;
  refusedAt(nested, "ports[0].privileged", /not a field a manifest may have/);
  const version = base();
  version.manifest = 2;
  refusedAt(version, "manifest", /has to be 1/);
  const missing = base();
  delete missing.manifest;
  refusedAt(missing, "manifest", /is required/);
});

test("the fields that would widen the container are not fields: there is nowhere to write them", () => {
  for (const name of ["privileged", "binds", "capAdd", "networkMode", "pidMode", "user", "devices", "securityOpt", "volumesFrom", "extraHosts", "sysctls"]) {
    const m = base();
    m[name] = name === "privileged" ? true : ["x"];
    refusedAt(m, name, /not a field a manifest may have/);
    const v = base();
    v.versions[0][name] = true;
    refusedAt(v, `versions[0].${name}`, /not a field a manifest may have/);
  }
});

test("a key that would rewrite an object's prototype is not a key", () => {
  const m = base();
  m.install.env = JSON.parse('{"__proto__": "x", "CONSTRUCTOR": "y"}');
  const result = validateManifest(m);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => p.path === "install.env.__proto__"));
});

/* ── Names, text, limits ──────────────────────────────────────── */

test("an id has the community prefix and is never a game Geeboard ships", () => {
  for (const id of ["terraria", "minecraft-java", "factorio", "community-", "community-A", "community-x", `community-${"a".repeat(40)}`, "Community-factorio"]) {
    const m = base();
    m.id = id;
    refusedAt(m, "id", /a community game's id/);
  }
  const ok = base();
  ok.id = "community-factorio";
  assert.ok(validateManifest(ok).ok);
});

test("a family that is a game Geeboard ships is refused: servers are grouped by it", () => {
  for (const family of ["Minecraft", "minecraft", "  Terraria "]) {
    const m = base();
    m.family = family;
    refusedAt(m, "family", /name of a game Geeboard ships/);
  }
});

test("text has a limit and no control characters, and an art has two short lines", () => {
  const control = base();
  control.name = "Bad\u0007Name";
  refusedAt(control, "name", /control character/);
  const newline = base();
  newline.blurb = "one\ntwo";
  refusedAt(newline, "blurb", /control character or a line break/);
  const long = base();
  long.name = "x".repeat(61);
  refusedAt(long, "name", /the most is 60/);
  const art = base();
  art.art = "A\nB\nC";
  refusedAt(art, "art", /more than 2 lines/);
  const wide = base();
  wide.art = "abcdefghijklmnopq";
  refusedAt(wide, "art", /longer than 14/);
});

test("counts are bounded: versions, ports, settings, a port's offset", () => {
  const versions = base();
  versions.versions = Array.from({ length: 31 }, (_, i) => ({ ...base().versions[0], id: `v${i}`, recommended: false }));
  refusedAt(versions, "versions", /the most is 30/);
  const ports = base();
  ports.ports = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, offset: i, protocol: "tcp", primary: i === 0 }));
  refusedAt(ports, "ports", /the most is 8/);
  const offset = base();
  offset.ports[1].offset = 40;
  refusedAt(offset, "ports[1].offset", /between 0 and 15/);
  const label = base();
  label.ports[0].label = "x".repeat(25);
  refusedAt(label, "ports[0].label", /the most is 24/);
});

test("an id used twice is a mistake: a version, a port, a template", () => {
  const version = base();
  version.versions.push({ ...version.versions[0] });
  refusedAt(version, "versions[4].id", /used twice/);
  const port = base();
  port.ports[1].id = port.ports[0].id;
  refusedAt(port, "ports[1].id", /used twice/);
});

test("a release date is a date, and at most one version is recommended", () => {
  const date = base();
  date.versions[0].released = "last week";
  refusedAt(date, "versions[0].released", /at least 10 characters/);
  const feb = base();
  feb.versions[0].released = "2026-02-31";
  refusedAt(feb, "versions[0].released", /has to be a date/);
  const two = base();
  two.versions.forEach((v: any) => (v.recommended = true));
  refusedAt(two, "versions", /more than one version marked recommended/);
});

test("a game with no version that can be installed is refused", () => {
  const m = base();
  m.versions.forEach((v: any) => (v.supported = false));
  refusedAt(m, "versions", /no version that can be installed/);
});

/* ── Ports ────────────────────────────────────────────────────── */

test("a block of ports may not reach what the machine, the proxy, the panel or the agent use", () => {
  for (const [portBase, hit] of [
    [2990, "3000"],
    [5400, "5432"],
    [8000, "8080"],
    [8700, "8711"],
    [2000, "2019"],
  ] as const) {
    const m = base();
    m.portBase = portBase;
    m.portSpan = 100;
    const problems = refusedAt(m, "portBase", new RegExp(`includes .*${hit}`));
    assert.ok(problems.length >= 1);
  }
});

test("a port below 1024 is refused, and so is a block that runs off the end", () => {
  const low = base();
  low.portBase = 80;
  refusedAt(low, "portBase", /between 1024 and 65000/);
  const high = base();
  high.portBase = 65000;
  high.portSpan = 2000;
  refusedAt(high, "portSpan", /highest is 65535/);
});

test("a probe on a port the game does not have is refused", () => {
  const m = base();
  m.health.probes = [{ kind: "port", port: "nonesuch" }];
  refusedAt(m, "health.probes[0].port", /not one of the game's ports/);
});

/* ── Mounts, environment, files ───────────────────────────────── */

test("mount points follow the agent's rules", () => {
  for (const [field, value] of [
    ["dataPath", "/etc/x"],
    ["dataPath", "/proc"],
    ["dataPath", "/"],
    ["dataPath", "/data/../etc"],
    ["dataPath", "data"],
    ["dataPath", "/var"],
    ["dataPath", "/a/b/c/d/e/f"],
  ] as const) {
    const m = base();
    m[field] = value;
    refusedAt(m, field, /mount point|cannot be used/);
  }
  const caches = base();
  caches.cachePaths = ["/a", "/b", "/c"];
  refusedAt(caches, "cachePaths", /the most is 2/);
  const overlap = base();
  overlap.dataPath = "/data";
  overlap.cachePaths = ["/data/cache"];
  refusedAt(overlap, "cachePaths[0]", /overlaps/);
});

test("environment names are valid and are not the panel's", () => {
  const prefix = base();
  prefix.install.env = { GEEBOARD_SERVER: "x" };
  refusedAt(prefix, "install.env.GEEBOARD_SERVER", /panel's to set/);
  const lower = base();
  lower.versions[0].env = { geeboard_x: "1" };
  refusedAt(lower, "versions[0].env.geeboard_x", /panel's to set/);
  const bad = base();
  bad.install.env = { "has space": "x" };
  refusedAt(bad, "install.env.has space", /not a valid environment variable name/);
  const target = base();
  target.config[0].target = { kind: "env", name: "GEEBOARD_X" };
  refusedAt(target, "config[0].target.name", /panel's to set/);
  const many = base();
  many.install.env = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`V${i}`, "1"]));
  refusedAt(many, "install.env", /the most is 32/);
});

test("a file a setting writes is inside the server's own folder", () => {
  for (const file of ["../x", "/etc/passwd", "a/../b", "a//b", ".hidden", "a/b/c/d/e/f/g", "a b", "x".repeat(121)]) {
    const m = base();
    m.config[0].target = { kind: "properties", file, key: "k" };
    const result = validateManifest(m);
    assert.equal(result.ok, false, file);
    assert.ok(!result.ok && result.problems.some((p) => p.path === "config[0].target.file"), file);
  }
  const ok = base();
  ok.config[0].target = { kind: "properties", file: "Server/config.ini", key: "k" };
  assert.ok(validateManifest(ok).ok);
});

test("a key a setting writes is a plain key, so it cannot start another line of the file", () => {
  for (const k of ["a=b", "a\nb", "a b", "", "x".repeat(101), "a;b"]) {
    const m = base();
    m.config[0].target = { kind: "properties", file: "x.cfg", key: k };
    const result = validateManifest(m);
    assert.equal(result.ok, false, JSON.stringify(k));
    assert.ok(!result.ok && result.problems.some((p) => p.path.startsWith("config[0].target")), JSON.stringify(k));
  }
});

test("a setting that would write a JSON file is refused, because the panel cannot write one and the first server would fail", () => {
  const m = base();
  m.config[0].target = { kind: "json", file: "config/server-settings.json", pointer: "/max_players" };
  refusedAt(m, "config[0].target.kind", /json is not a kind the panel can write yet/);
});

/* ── Regular expressions ──────────────────────────────────────── */

test("an expression that goes exponential is refused wherever the manifest puts one", () => {
  const where: Array<[string, (m: any) => void]> = [
    ["health.readyPattern", (m) => (m.health.readyPattern = "^(a+)+$")],
    ["health.crashPattern", (m) => (m.health.crashPattern = "(a*)*b")],
    ["health.failures[0].pattern", (m) => (m.health.failures = [{ pattern: "(x+x+)+y", reason: "r" }])],
    ["health.probes[0].pattern", (m) => (m.health.probes = [{ kind: "log", pattern: "^(\\w+\\s?)*$" }])],
    ["console.players.join", (m) => (m.console.players = { join: "^(?<name>(a+)+)$", leave: "^(?<name>\\S+) left$" })],
    ["console.healthLines", (m) => (m.console.healthLines = "(a|aa)+")],
    ["config[0].pattern.regex", (m) => (m.config[0].pattern = { regex: "^(a+)+$", message: "no" })],
  ];
  for (const [path, mutate] of where) {
    const m = base();
    mutate(m);
    refusedAt(m, path, /repeats too|alternation/);
  }
});

test("a back-reference, a look-behind and an expression of 201 characters are refused", () => {
  for (const [regex, reason] of [
    ["(a)\\1", /back-reference/],
    ["(?<=a)b", /look-behind/],
    ["x".repeat(201), /201 characters/],
    ["(", /compile/],
  ] as const) {
    const m = base();
    m.health.readyPattern = regex;
    refusedAt(m, "health.readyPattern", reason);
  }
});

test("an expression the static check lets through and the timed run does not is refused at approval", () => {
  const m = base();
  m.health.readyPattern = ".*.*.*x";
  refusedAt(m, "health.readyPattern", /took more than 40 ms/);
  // Switched off, it is accepted: the probe is what caught it.
  assert.ok(validateManifest(m, { probe: false }).ok);
});

/* ── The settings ─────────────────────────────────────────────── */

test("a password that does not say it is secret is refused, by the rule the shipped games are held to", () => {
  const m = base();
  m.config.push({ key: "adminPassword", label: "Admin password", type: "string", target: { kind: "env", name: "ADMIN_PW" }, default: "" });
  const result = validateManifest(m);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => /looks like a password and is not marked secret/.test(p.message)));
});

test("a default that its own field would refuse is refused", () => {
  const range = base();
  const number = range.config.find((f: any) => f.type === "number");
  number.default = number.max + 1;
  const result = validateManifest(range);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => p.path === "config" && /the default of/.test(p.message)));
});

test("a template that sets a setting out of range, or one the game does not have, is refused", () => {
  const range = base();
  const field = range.config.find((f: any) => f.type === "number");
  range.templates[0].config = { [field.key]: field.max + 1 };
  refusedAt(range, "templates[0]", /must be at most/);
  const unknown = base();
  unknown.templates[0].config = { nonesuch: 1 };
  const result = validateManifest(unknown);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => /unknown config key nonesuch/.test(p.message)));
});

test("a setting's key is a name, and two settings do not share one", () => {
  const dup = base();
  dup.config.push({ ...dup.config[0] });
  const result = validateManifest(dup);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.some((p) => /share the key/.test(p.message)));
  const bad = base();
  bad.config[0].key = "has space";
  refusedAt(bad, "config[0].key", /camel-case/);
});

/* ── The input itself ─────────────────────────────────────────── */

test("what is not JSON is refused with where it goes wrong, and an array is not a manifest", () => {
  const text = JSON.stringify(base());
  const broken = validateManifest(`{ /* a comment */${text.slice(1)}`);
  assert.equal(broken.ok, false);
  assert.ok(!broken.ok && /is not JSON/.test(broken.problems[0]!.message) && broken.hash === null);
  const array = validateManifest("[]");
  assert.deepEqual(!array.ok && array.problems, [{ path: "", message: "has to be an object" }]);
  const string = validateManifest('"hello"');
  assert.equal(string.ok, false);
});

test("a manifest too large, or nested too deep, is refused before it is read", () => {
  const big = validateManifest(`{"manifest":1,"pad":"${"x".repeat(MAX_MANIFEST_CHARS)}"}`);
  assert.ok(!big.ok && /the most is 65536/.test(big.problems[0]!.message));
  let deep: unknown = "x";
  for (let i = 0; i < 20; i++) deep = { a: deep };
  const result = validateManifest({ manifest: 1, deep });
  assert.ok(!result.ok && /nests deeper than 12/.test(result.problems[0]!.message));
});

test("problems are capped, and every one says where", () => {
  const m = base();
  m.config = Array.from({ length: 60 }, () => ({ key: "bad key", label: "", type: "nope", target: {}, default: {} }));
  const result = validateManifest(m);
  assert.ok(!result.ok);
  assert.equal(result.problems.length, 60);
  assert.ok(result.problems.every((p) => typeof p.path === "string" && p.message.length > 0));
});

/* ── The hash ─────────────────────────────────────────────────── */

test("the hash does not depend on spacing or on the order of keys, and does depend on every character of what is said", () => {
  const m = base();
  const shuffled = Object.fromEntries(Object.entries(m).reverse());
  const spaced = JSON.stringify(m, null, 4);
  const a = validateManifest(m);
  const b = validateManifest(shuffled);
  const c = validateManifest(spaced);
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, c.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(a.canonical, canonicalJson(m));
  const changed = base();
  changed.blurb = `${changed.blurb}.`;
  const d = validateManifest(changed);
  assert.ok(d.ok);
  assert.notEqual(d.hash, a.hash);
  const image = base();
  image.versions[0].image = pinned("ryshe/terraria:other");
  const e = validateManifest(image);
  assert.ok(e.ok && e.hash !== a.hash, "a different digest is a different manifest");
});

test("a refusal still has a hash when the manifest parsed, so the attempt can be named", () => {
  const m = base();
  m.id = "terraria";
  const result = validateManifest(m);
  assert.ok(!result.ok && result.hash === hashOf(canonicalJson(m)));
});

test("canonical JSON sorts keys at every depth and keeps arrays in order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null } }), '{"a":{"c":null,"d":[3,1,2]},"b":1}');
  assert.equal(canonicalJson("x"), '"x"');
});
