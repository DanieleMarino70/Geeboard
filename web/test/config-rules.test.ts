import assert from "node:assert/strict";
import { test } from "node:test";
import { validateConfig } from "../src/domain/games/config";
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
