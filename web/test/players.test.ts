import assert from "node:assert/strict";
import { test } from "node:test";
import { requireGame } from "../src/domain/games/registry.ts";
import { advanceCursor, playerEvents, readFrom, unreadLines } from "../src/domain/servers/players.ts";

/* Players, read from what a server's console says. The panel said
   "0 / 40 online" on every server because nothing read it. */

const at = (s: number) => new Date(Date.UTC(2026, 8, 17, 12, 0, s)).toISOString();

test("Minecraft: joins and leaves come out in order, with the name", () => {
  const events = playerEvents(requireGame("minecraft-java").console, [
    { line: "[12:00:01 INFO]: Steve joined the game", at: at(1) },
    { line: "[12:00:02] [Server thread/INFO]: Alex_2 joined the game", at: at(2) },
    { line: "[12:00:05 INFO]: Steve left the game", at: at(5) },
  ]);
  assert.deepEqual(
    events.map((e) => [e.kind, e.name]),
    [
      ["join", "Steve"],
      ["join", "Alex_2"],
      ["leave", "Steve"],
    ],
  );
});

test("a chat message pretending to be a join is not one", () => {
  const minecraft = playerEvents(requireGame("minecraft-java").console, [
    { line: "[12:00:01 INFO]: <Steve> Notch joined the game", at: at(1) },
    { line: "[12:00:01 INFO]: [Server] Notch joined the game", at: at(1) },
  ]);
  assert.equal(minecraft.length, 0);

  const terraria = playerEvents(requireGame("terraria").console, [
    { line: "<Steve> Notch has joined.", at: at(1) },
    { line: "Steve has joined. and more", at: at(1) },
  ]);
  assert.equal(terraria.length, 0);
});

test("Terraria and Bedrock have their own wording", () => {
  const terraria = playerEvents(requireGame("terraria").console, [
    { line: "Dirt Digger has joined.", at: at(1) },
    { line: "Dirt Digger has left.", at: at(9) },
  ]);
  assert.deepEqual(terraria.map((e) => [e.kind, e.name]), [
    ["join", "Dirt Digger"],
    ["leave", "Dirt Digger"],
  ]);

  const bedrock = playerEvents(requireGame("minecraft-bedrock").console, [
    { line: "[2026-09-17 12:00:01:123 INFO] Player connected: Steve Two, xuid: 2535", at: at(1) },
    { line: "[2026-09-17 12:00:04:123 INFO] Player disconnected: Steve Two, xuid: 2535", at: at(4) },
  ]);
  assert.deepEqual(bedrock.map((e) => [e.kind, e.name]), [
    ["join", "Steve Two"],
    ["leave", "Steve Two"],
  ]);
});

test("a game that says nothing readable counts nobody", () => {
  const dialect = { ...requireGame("valheim").console, players: undefined };
  assert.deepEqual(playerEvents(dialect, [{ line: "Got character ZDOID from Steve : 1:1", at: at(1) }]), []);
});

/* Valheim names a character on arrival and a Steam id on departure, so
   the two are paired through the connection line that comes first.
   Written from the server's known output; not yet seen with a client. */
test("Valheim: a connection id is paired with the next character, and a closing socket is that character leaving", () => {
  const valheim = requireGame("valheim").console;
  const events = playerEvents(valheim, [
    { line: "09/17/2026 12:00:01: Got connection SteamID 76561198000000001", at: at(1) },
    { line: "09/17/2026 12:00:02: Got character ZDOID from Bob the Brave : -1234567:1", at: at(2) },
    { line: "09/17/2026 12:00:03: Got connection SteamID 76561198000000002", at: at(3) },
    { line: "09/17/2026 12:00:04: Got character ZDOID from Alice : 7654321:1", at: at(4) },
    // A death and a respawn print the character line again.
    { line: "09/17/2026 12:00:05: Got character ZDOID from Bob the Brave : -1234567:2", at: at(5) },
    { line: "09/17/2026 12:00:09: Closing socket 76561198000000001", at: at(9) },
    // A socket nobody was paired with: a connection that never became a player.
    { line: "09/17/2026 12:00:10: Closing socket 76561198000000009", at: at(10) },
  ]);
  assert.deepEqual(
    events.map((e) => [e.kind, e.name, e.id]),
    [
      ["join", "Bob the Brave", "76561198000000001"],
      ["join", "Alice", "76561198000000002"],
      ["join", "Bob the Brave", "76561198000000001"],
      ["leave", "Bob the Brave", "76561198000000001"],
    ],
  );
});

test("a pairing survives a cursor between its two lines", () => {
  const valheim = requireGame("valheim").console;
  const lines = [
    { line: "Got connection SteamID 76561198000000001", at: at(1) },
    { line: "Got character ZDOID from Bob : 1:1", at: at(3) },
    { line: "Closing socket 76561198000000001", at: at(5) },
  ];
  // The connection was counted on the last pass; the character was not.
  const events = playerEvents(valheim, lines, new Date(at(2)));
  assert.deepEqual(events.map((e) => [e.kind, e.name]), [
    ["join", "Bob"],
    ["leave", "Bob"],
  ]);
  // Nothing new after the last line: no event, however many times it is read.
  assert.deepEqual(playerEvents(valheim, lines, new Date(at(5))), []);
});

test("Project Zomboid: the quoted account name on login and on leaving", () => {
  const zomboid = requireGame("project-zomboid").console;
  const events = playerEvents(zomboid, [
    { line: 'LOG  : General      f:0 st:1> User "mara" fully connected (10534,9713,0)', at: at(1) },
    { line: 'LOG  : General      f:0 st:2> Connected new client mara ID # 1', at: at(1) },
    { line: 'LOG  : General      f:0 st:3> Disconnected player "mara" 76561198000000001', at: at(4) },
  ]);
  assert.deepEqual(events.map((e) => [e.kind, e.name]), [
    ["join", "mara"],
    ["leave", "mara"],
  ]);
});

test("a line with no time is not counted — it cannot be placed or deduplicated", () => {
  assert.equal(playerEvents(requireGame("terraria").console, [{ line: "Steve has joined." }]).length, 0);
});

/* The cursor. Docker's `since` is whole seconds, so a read returns lines
   already counted; they must not be counted again. */
test("only lines after the cursor are unread, and the cursor moves to the newest", () => {
  const lines = [
    { line: "a", at: at(1) },
    { line: "b", at: at(2) },
    { line: "c", at: at(3) },
  ];
  const cursor = new Date(at(2));
  assert.deepEqual(unreadLines(lines, cursor).map((l) => l.line), ["c"]);
  assert.deepEqual(unreadLines(lines, null).map((l) => l.line), ["a", "b", "c"]);
  assert.equal(advanceCursor(lines, null)?.toISOString(), at(3));
  assert.equal(advanceCursor([], cursor), cursor, "no lines keeps the cursor");
});

test("a new run is read from its own start, not from the last run's cursor", () => {
  const lastRun = new Date(at(10));
  const thisRun = new Date(at(30));
  assert.equal(readFrom(lastRun, thisRun), thisRun);
  assert.equal(readFrom(new Date(at(40)), thisRun)?.toISOString(), at(40));
  assert.equal(readFrom(null, thisRun), thisRun);
});
