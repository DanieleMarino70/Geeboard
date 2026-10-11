import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigField } from "../src/domain/games/types.ts";
import {
  changedServerKeys,
  fieldCost,
  groupNote,
  pendingChanges,
  rebuildSentence,
  rowBadge,
  shownValue,
  summarize,
} from "../src/lib/settings-summary.ts";
import type { SettingsInput } from "../src/lib/settings-rules.ts";

/* What the Settings page's one save bar says before anything is saved: how many settings change, how many of them wait for a restart and how
   many for a rebuild, and what each group of settings does when saved. A person who changed the MOTD and the CPU limit used to press two
   buttons and was told about neither cost until after. */

const motd: ConfigField = { key: "motd", label: "MOTD", type: "string", default: "", group: "Presentation", restartRequired: true, target: { kind: "properties", file: "serverconfig.txt", key: "motd" } };
const players: ConfigField = { key: "maxPlayers", label: "Max players", type: "number", default: 8, group: "Players", restartRequired: true, target: { kind: "properties", file: "serverconfig.txt", key: "maxplayers" } };
const password: ConfigField = { key: "password", label: "Server password", type: "string", default: "", group: "Players", secret: true, restartRequired: true, target: { kind: "properties", file: "serverconfig.txt", key: "password" } };
const mode: ConfigField = { key: "mode", label: "Game mode", type: "enum", default: "survival", group: "World", target: { kind: "env", name: "MODE" }, options: [{ value: "survival", label: "Survival" }, { value: "creative", label: "Creative" }] };
const seed: ConfigField = { key: "seed", label: "World seed", type: "string", default: "", group: "World", fixedAfterCreation: true, target: { kind: "env", name: "SEED" } };
const map: ConfigField = { key: "map", label: "Map", type: "string", default: "gm_construct", group: "Game", target: { kind: "arg", flag: "+map" } };
const live: ConfigField = { key: "rate", label: "Rate", type: "number", default: 1, group: "Performance", target: { kind: "ini", file: "Server/geeboard.ini", section: "", key: "Rate" } };
const cvar: ConfigField = { key: "name", label: "Server name", type: "string", default: "", group: "Game", restartRequired: true, target: { kind: "cvar", file: "geeboard/server.cfg", name: "hostname" } };

const saved: SettingsInput = { name: "Aurora", host: "play.example.com", memoryLimit: 6, cpuLimit: 200, restartPolicy: "ON_FAILURE", maxRestarts: 3 };

test("a setting's cost is the one the save applies", () => {
  assert.equal(fieldCost(motd), "restart");
  assert.equal(fieldCost(mode), "rebuild", "an environment variable is fixed when the workload is made");
  assert.equal(fieldCost(map), "rebuild", "and so is a start argument");
  assert.equal(fieldCost(seed), "fixed", "fixed after creation wins over its target");
  assert.equal(fieldCost(live), "now");
});

test("a group says once what it does when saved, and names its file", () => {
  assert.deepEqual(groupNote([motd, players]), { cost: "restart", text: "Written to serverconfig.txt when saved; the game reads it at the next restart." });
  assert.equal(groupNote([mode])?.text, "Given to the server when it is made: saving a change rebuilds it around the same world.");
  assert.equal(groupNote([live])?.text, "Written to geeboard.ini when saved.", "the file's name, not its path");
  assert.equal(groupNote([seed])?.cost, "fixed");
  assert.equal(groupNote([]), null);
});

test("a group of two files says the server's files", () => {
  const other = { ...players, target: { kind: "properties" as const, file: "other.txt", key: "x" } };
  assert.match(groupNote([motd, other])!.text, /^Written to the server's files when saved/);
});

test("a row is badged only where it differs from its group", () => {
  // Garry's Mod's Game group: a map and a gamemode on the command line, a name in server.cfg.
  const gmod = [map, { ...map, key: "gamemode", label: "Gamemode" }, cvar];
  const note = groupNote(gmod)!;
  assert.equal(note.cost, "rebuild", "the cost most of the group shares");
  assert.equal(rowBadge(map, note.cost), null);
  assert.equal(rowBadge(cvar, note.cost), "restart");
  // A seed in a World group of rebuilds keeps its own badge.
  assert.equal(rowBadge(seed, groupNote([mode, seed])!.cost), "fixed");
});

test("a tie goes to the dearer cost, so a heading never promises less than its rows", () => {
  assert.equal(groupNote([mode, motd])!.cost, "rebuild");
  assert.equal(groupNote([motd, live])!.cost, "restart");
});

test("three changes, one at the next restart and one needing a rebuild", () => {
  const changes = pendingChanges({
    game: { fields: [motd, mode, players], initial: { motd: "Hi", mode: "survival", maxPlayers: 8 }, values: { motd: "Hello", mode: "creative", maxPlayers: 8 } },
    server: { initial: saved, values: { ...saved, name: "Aurora Two" }, limitsNeedRebuild: true },
  });
  assert.deepEqual(
    changes.map((c) => [c.section, c.label, c.from, c.to, c.cost]),
    [
      ["game", "MOTD", "Hi", "Hello", "restart"],
      ["game", "Game mode", "Survival", "Creative", "rebuild"],
      ["server", "Server name", "Aurora", "Aurora Two", "now"],
    ],
  );
  const summary = summarize(changes);
  assert.equal(summary.sentence, "3 changes · 1 applies at the next restart · 1 needs a rebuild");
  assert.equal(summary.gameNeedsRebuild, true);
});

test("new resource limits need a rebuild only where there is a workload to rebuild", () => {
  const values = { ...saved, memoryLimit: 8, cpuLimit: 300 };
  const real = pendingChanges({ server: { initial: saved, values, limitsNeedRebuild: true } });
  assert.deepEqual(real.map((c) => [c.label, c.from, c.to, c.cost]), [
    ["Memory limit", "6 GB", "8 GB", "rebuild"],
    ["CPU limit", "200%", "300%", "rebuild"],
  ]);
  const summary = summarize(real);
  assert.equal(summary.sentence, "2 changes · 2 need a rebuild");
  assert.equal(summary.gameNeedsRebuild, false, "a limit can be saved and rebuilt later; an environment variable cannot");
  const simulated = pendingChanges({ server: { initial: saved, values, limitsNeedRebuild: false } });
  assert.equal(summarize(simulated).sentence, "2 changes");
});

test("restarts are counted in the plural too", () => {
  const changes = pendingChanges({ game: { fields: [motd, players], initial: { motd: "a", maxPlayers: 8 }, values: { motd: "b", maxPlayers: 9 } } });
  assert.equal(summarize(changes).sentence, "2 changes · 2 apply at the next restart");
});

test("nothing changed is no change, and an emptied number is one", () => {
  assert.deepEqual(pendingChanges({ server: { initial: saved, values: { ...saved }, limitsNeedRebuild: true } }), []);
  assert.deepEqual(changedServerKeys(saved, { ...saved, maxRestarts: Number.NaN }), ["maxRestarts"]);
  assert.equal(pendingChanges({ server: { initial: saved, values: { ...saved, maxRestarts: Number.NaN }, limitsNeedRebuild: false } })[0]?.to, "empty");
});

test("a password is never shown in the list, either side", () => {
  const [change] = pendingChanges({ game: { fields: [password], initial: { password: "••••••••" }, values: { password: "hunter22" } } });
  assert.equal(change?.from, "set");
  assert.equal(change?.to, "a new one");
  assert.equal(shownValue(password, ""), "not set");
  const [cleared] = pendingChanges({ game: { fields: [password], initial: { password: "••••••••" }, values: { password: "" } } });
  assert.equal(cleared?.to, "not set");
});

test("values read as the form shows them", () => {
  assert.equal(shownValue({ type: "boolean" }, true), "on");
  assert.equal(shownValue({ type: "boolean" }, false), "off");
  assert.equal(shownValue(mode, "creative"), "Creative");
  assert.equal(shownValue({ type: "string" }, ""), "empty");
  assert.equal(shownValue({ type: "text" }, "x".repeat(60)).length, 40);
  assert.equal(pendingChanges({ server: { initial: saved, values: { ...saved, restartPolicy: "NEVER" }, limitsNeedRebuild: false } })[0]?.to, "Leave it down");
});

test("the rebuild is asked for in the words the page used, over every change that needs one", () => {
  const changes = pendingChanges({
    game: { fields: [mode], initial: { mode: "survival" }, values: { mode: "creative" } },
    server: { initial: saved, values: { ...saved, memoryLimit: 8 }, limitsNeedRebuild: true },
  });
  assert.equal(
    rebuildSentence(changes),
    "Game mode and Memory limit are fixed when the server is created, so applying them means stopping the server and making a new one around the same world. The world, its files and its address are kept; players are disconnected while it happens.",
  );
  assert.match(rebuildSentence(changes.slice(0, 1)), /^Game mode is fixed .* applying it means/);
});
