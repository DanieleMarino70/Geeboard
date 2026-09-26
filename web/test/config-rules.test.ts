import assert from "node:assert/strict";
import { test } from "node:test";
import { auditedChanges, secretKeys, settingsFor, validateConfig, withoutSecrets } from "../src/domain/games/config";
import { allGames } from "../src/domain/games/registry";
import { acceptsCommands, redactSecrets, resourceEnvFor } from "../src/domain/games/types";
import type { GameDefinition } from "../src/domain/games/types";

/* Rules a game has about one setting in terms of another, and whether a
   game can be typed at. Both are facts about the game, declared in its
   definition rather than branched on somewhere in the platform. */

const game = {
  name: "Testland",
  config: [
    { key: "worldName", label: "World name", type: "string", default: "geeboard", target: { kind: "env", name: "W" } },
    { key: "public", label: "List publicly", type: "boolean", default: false, target: { kind: "env", name: "P" } },
    {
      key: "password", label: "Server password", type: "string", default: "",
      minLength: 5, requiredWhen: { key: "public", equals: true }, mustNotContain: "worldName",
      target: { kind: "env", name: "S" },
    },
  ],
} as unknown as GameDefinition;

const messages = (values: Record<string, unknown>) =>
  validateConfig(game, values as never).map((p) => `${p.label} ${p.message}`);

test("an empty password is fine while the server is unlisted", () => {
  assert.deepEqual(messages({ password: "", public: false }), []);
});

test("listing the server publicly makes the password necessary", () => {
  assert.deepEqual(messages({ password: "", public: true }), ["Server password is needed when list publicly is on"]);
});

test("a password shorter than the game allows is refused, empty is not", () => {
  assert.deepEqual(messages({ password: "abc" }), ["Server password must be at least 5 characters"]);
  assert.deepEqual(messages({ password: "abcdef" }), []);
});

test("a password containing the world name is refused, whatever its case", () => {
  assert.deepEqual(messages({ password: "myGeeboardpass", worldName: "geeboard" }), [
    "Server password must not contain the world name",
  ]);
  assert.deepEqual(messages({ password: "myGeeboardpass", worldName: "elsewhere" }), []);
});

test("the cross-field rules read the settings the server would end up with", () => {
  // `public` is not in the values, so its default decides — and it is false.
  assert.deepEqual(messages({ password: "" }), []);
});

test("a game with no command of any kind accepts none", () => {
  assert.equal(acceptsCommands({ examples: [] }), false);
  assert.equal(acceptsCommands({ stopCommand: "stop" }), true);
  assert.equal(acceptsCommands({ examples: ["list"] }), true);
  assert.equal(acceptsCommands({ broadcastCommand: "say %s" }), true);
});

test("a workload is told its heap and the ports it actually got", () => {
  const jvm = {
    ports: [
      { id: "game", label: "Game", offset: 0, protocol: "udp" },
      { id: "direct", label: "Direct", offset: 1, protocol: "udp" },
    ],
    resourceEnv: { memory: { name: "MEMORY", percent: 75 }, ports: { game: "PORT", direct: "UDPPORT" } },
  } as unknown as GameDefinition;

  // The second server on a node: its ports are not the game's defaults.
  assert.deepEqual(resourceEnvFor(jvm, { memoryMb: 8192, portBase: 16461 }), {
    MEMORY: "6144m",
    PORT: "16461",
    UDPPORT: "16462",
  });
  assert.deepEqual(resourceEnvFor({ ports: [] } as unknown as GameDefinition, { memoryMb: 4096, portBase: 1 }), {});
});

test("a generated secret is fresh each time and blanked out of console output", () => {
  const game = {
    ports: [],
    resourceEnv: { secrets: { ADMINPASSWORD: "gbadmin" } },
  } as unknown as GameDefinition;

  const env = resourceEnvFor(game, { memoryMb: 1024, portBase: 1 }, () => "0123456789abcdef0123456789abcdef");
  assert.equal(env.ADMINPASSWORD, "gbadmin-0123456789abcdef0123456789abcdef");
  assert.match(resourceEnvFor(game, { memoryMb: 1024, portBase: 1 }).ADMINPASSWORD!, /^gbadmin-[0-9a-f]{32}$/);
  assert.notEqual(
    resourceEnvFor(game, { memoryMb: 1024, portBase: 1 }).ADMINPASSWORD,
    resourceEnvFor(game, { memoryMb: 1024, portBase: 1 }).ADMINPASSWORD,
  );

  // Exactly how Zomboid prints it, on every start.
  assert.equal(
    redactSecrets(game, `pzexe: arg: ${env.ADMINPASSWORD}`),
    "pzexe: arg: gbadmin-[redacted]",
  );
  // A game with no secrets, or no definition at all, passes lines through.
  assert.equal(redactSecrets(undefined, "gbadmin-0123456789abcdef0123456789abcdef"), "gbadmin-0123456789abcdef0123456789abcdef");
});

/* A join password went to every account that opened a server's settings,
   and into the audit log of every change to it, until September 2026. */
const locked = {
  config: [
    { key: "motd", label: "MOTD", type: "string", default: "", target: { kind: "env", name: "M" } },
    { key: "password", label: "Server password", type: "string", default: "", secret: true, target: { kind: "env", name: "S" } },
  ],
} as unknown as Pick<GameDefinition, "config">;

test("whoever may not change the settings is not given a secret, and is told which were kept", () => {
  const read = {
    stored: { motd: "hello", password: "hunter2" },
    onNode: { motd: "hello", password: "hunter3" },
    drift: [
      { key: "password", label: "Server password", stored: "hunter2", onServer: "hunter3" },
      { key: "motd", label: "MOTD", stored: "hi", onServer: "hello" },
    ],
  };
  const shown = settingsFor(locked, false, read);
  assert.deepEqual(shown.stored, { motd: "hello" });
  assert.deepEqual(shown.onNode, { motd: "hello" });
  assert.deepEqual(shown.drift.map((d) => d.key), ["motd"]);
  assert.deepEqual(shown.hidden, ["password"]);
  assert.ok(!JSON.stringify(shown).includes("hunter"));

  // Whoever may change them is given everything, and nothing is called hidden.
  assert.deepEqual(settingsFor(locked, true, read), { ...read, hidden: [] });
  assert.deepEqual(secretKeys(locked), ["password"]);
  assert.deepEqual(withoutSecrets(locked, { password: "x" }), {});
});

test("a secret's change is recorded as a change, and never what it was or became", () => {
  const changes = auditedChanges(locked, [
    { key: "password", label: "Server password", from: "hunter2", to: "hunter3" },
    { key: "motd", label: "MOTD", from: "hi", to: "hello" },
  ]);
  assert.deepEqual(changes, {
    "Server password": { from: "not recorded", to: "changed" },
    MOTD: { from: "hi", to: "hello" },
  });
});

test("every game's password setting says it is secret", () => {
  // The registry refuses one that does not; this names the ones that do.
  const passwords = allGames().flatMap((g) => g.config.filter((f) => /password/i.test(f.label)).map((f) => `${g.id}:${f.key}:${f.secret === true}`));
  // Terraria, Zomboid and Valheim; Palworld's is marked too, and parked out of the registry.
  assert.ok(passwords.length >= 3, passwords.join(", "));
  assert.deepEqual(passwords.filter((p) => !p.endsWith(":true")), []);
});
