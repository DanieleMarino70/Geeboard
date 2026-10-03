import assert from "node:assert/strict";
import { test } from "node:test";
import { previewOf, CANNOT_DO, CAN_DO } from "../src/domain/games/preview.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { PROJECT_ZOMBOID } from "../src/domain/games/definitions/project-zomboid.ts";
import type { GameDefinition } from "../src/domain/games/types.ts";

/* What an owner is shown before approving a game. */

const pinned = (game: GameDefinition): GameDefinition => ({
  ...game,
  versions: game.versions.map((v) => ({ ...v, image: `${v.image.replace(/@.*$/, "")}@sha256:${"ab".repeat(32)}` })),
});

test("every version shows its image to the digest, its registry first", () => {
  const preview = previewOf(pinned(TERRARIA));
  assert.equal(preview.versions.length, TERRARIA.versions.length);
  for (const v of preview.versions) {
    assert.ok(v.image);
    assert.equal(v.image.registry, "docker.io");
    assert.equal(v.image.digest, `sha256:${"ab".repeat(32)}`);
    assert.ok(v.image.written.endsWith(v.image.digest));
  }
});

test("an image that does not parse is shown as missing, not guessed at", () => {
  const preview = previewOf({ ...TERRARIA, versions: [{ ...TERRARIA.versions[0]!, image: "no digest here" }] });
  assert.equal(preview.versions[0]!.image, null);
});

test("the environment is the install's and the version's together, and the panel's own variables are named apart", () => {
  const preview = previewOf(pinned(TERRARIA));
  assert.ok(preview.versions[0]!.env.some((e) => e.name === "CONFIGPATH"));
  assert.ok(preview.panelEnv.includes("GEEBOARD_SERVER"));
  const zomboid = previewOf(pinned(PROJECT_ZOMBOID));
  assert.ok(zomboid.panelEnv.length > 1, "a game's memory and port variables are the panel's too");
});

test("ports say who can reach them", () => {
  const preview = previewOf(pinned(TERRARIA));
  const game = preview.ports.find((p) => p.id === "game")!;
  const rest = preview.ports.find((p) => p.id === "rest")!;
  assert.equal(game.exposure, "everyone who can reach the node");
  assert.equal(rest.exposure, "the node itself only (127.0.0.1)");
  assert.equal(game.container, 7777);
});

test("the mounts are the server's folder and any cache, each said for what it is", () => {
  const zomboid = previewOf(pinned(PROJECT_ZOMBOID));
  assert.equal(zomboid.mounts[0]!.path, "/home/steam/Zomboid");
  assert.match(zomboid.mounts[0]!.what, /backed up/);
  assert.ok(zomboid.mounts.slice(1).every((m) => /no backup/.test(m.what)));
  assert.equal(previewOf(pinned(TERRARIA)).mounts[0]!.path, "/data");
});

test("what the panel types at the console is listed, and what it asks over RCON too", () => {
  const preview = previewOf(pinned(TERRARIA));
  assert.ok(preview.console.some((c) => c.when === "to stop it" && c.text === TERRARIA.console.stopCommand));
  const rcon = previewOf({ ...TERRARIA, health: { ...TERRARIA.health, probes: [{ kind: "rcon", command: "Info" }] } });
  assert.ok(rcon.console.some((c) => /RCON/.test(c.when) && c.text === "Info"));
  assert.ok(rcon.probes.some((p) => /RCON command Info/.test(p)));
});

test("the files the panel writes are named, once each, with how", () => {
  const preview = previewOf(pinned(TERRARIA));
  const config = preview.files.find((f) => f.file === "serverconfig.txt");
  assert.ok(config);
  assert.match(config.how, /fixed lines: worldpath, port/);
  assert.match(config.how, /properties setting difficulty/);
  assert.equal(preview.files.filter((f) => f.file === "serverconfig.txt").length, 1);
});

test("a secret setting says so, and every setting says where it lands", () => {
  const preview = previewOf(pinned(TERRARIA));
  const password = preview.settings.find((s) => s.key === "password")!;
  assert.equal(password.secret, true);
  assert.match(password.where, /serverconfig\.txt, key password/);
  assert.ok(preview.settings.every((s) => s.where.length > 0));
});

test("every expression the panel will run is listed, with where", () => {
  const preview = previewOf(pinned(PROJECT_ZOMBOID));
  assert.ok(preview.expressions.length > 0);
  assert.ok(preview.expressions.every((e) => e.pattern.length > 0 && e.where.length > 0));
  assert.ok(preview.expressions.some((e) => e.where === "a player joins"));
});

test("a community game requires the node's consent only when its definition says so, and the preview repeats it", () => {
  const preview = previewOf({ ...pinned(TERRARIA), requirements: { ...TERRARIA.requirements, capabilities: ["docker", "community-games"] } });
  assert.deepEqual(preview.requires, ["docker", "community-games"]);
});

test("what an image cannot and can do is said in full sentences, and the risky half is the longer one to read", () => {
  assert.ok(CANNOT_DO.length >= 4 && CAN_DO.length >= 4);
  assert.ok(CAN_DO.some((s) => /169\.254\.169\.254/.test(s)), "the metadata service, measured on a real node");
  assert.ok(CAN_DO.some((s) => /root/.test(s)));
  assert.ok(CANNOT_DO.some((s) => /privileged/.test(s)));
  assert.ok(CANNOT_DO.some((s) => /digest/.test(s)));
  assert.ok([...CAN_DO, ...CANNOT_DO].every((s) => s.length > 40 && !s.endsWith(".")));
});
