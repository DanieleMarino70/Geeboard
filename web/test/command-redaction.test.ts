import assert from "node:assert/strict";
import { test } from "node:test";
import { TYPED_SECRET_MARK, redactTyped } from "../src/domain/games/config.ts";
import { allGames, findGame } from "../src/domain/games/registry.ts";

/* The audit log is read by every account that may read a console command, searched by `q` and exported as a CSV, and it is careful never to
   record what a password changed from or to. A join password typed at the console was kept in clear in that very table. The command goes to the
   game as it was typed; the record is written without the secret. */

const terraria = findGame("terraria")!;
const withSecret = { password: "hunter2-verify" };

test("a secret setting's value, typed into a command, is not what the log keeps", () => {
  assert.equal(redactTyped(terraria, withSecret, "password hunter2-verify"), `password ${TYPED_SECRET_MARK}`);
  assert.equal(redactTyped(terraria, withSecret, "say the password is hunter2-verify, twice: hunter2-verify"), `say the password is ${TYPED_SECRET_MARK}, twice: ${TYPED_SECRET_MARK}`);
});

test("a command with no secret in it is kept as it was typed", () => {
  assert.equal(redactTyped(terraria, withSecret, "say restarting in 5"), "say restarting in 5");
  assert.equal(redactTyped(terraria, { password: "" }, "say hello"), "say hello");
});

test("a value too short to be told apart from the rest of the log is not hidden, and neither is anything when there is no setting to read", () => {
  assert.equal(redactTyped(terraria, { password: "abc" }, "say abc"), "say abc");
  assert.equal(redactTyped(terraria, null, "password hunter2-verify"), "password hunter2-verify");
  assert.equal(redactTyped(undefined, withSecret, "password hunter2-verify"), "password hunter2-verify");
});

test("a password that contains another leaves no tail behind", () => {
  const game = { config: [{ key: "a", secret: true }, { key: "b", secret: true }] } as unknown as Parameters<typeof redactTyped>[0];
  assert.equal(redactTyped(game, { a: "open-sesame", b: "open-sesame-twice" }, "x open-sesame-twice y open-sesame z"), `x ${TYPED_SECRET_MARK} y ${TYPED_SECRET_MARK} z`);
});

test("only a setting the game marks secret is read, and only for the games that have one", () => {
  const holders = allGames().filter((g) => g.config.some((f) => f.secret === true));
  assert.ok(holders.length > 0, "no shipped game has a secret setting: the test is looking at nothing");
  const plain = allGames().find((g) => !g.config.some((f) => f.secret === true));
  if (plain) assert.equal(redactTyped(plain, { maxPlayers: "20-players" }, "say 20-players"), "say 20-players");
});
