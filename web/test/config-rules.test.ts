import assert from "node:assert/strict";
import { test } from "node:test";
import { validateConfig } from "../src/domain/games/config";
import { acceptsCommands } from "../src/domain/games/types";
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
