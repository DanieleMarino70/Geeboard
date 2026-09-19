import assert from "node:assert/strict";
import { test } from "node:test";
import { requireGame } from "../src/domain/games/registry.ts";
import { normaliseTask, payloadForForm, validateTask, type TaskInput } from "../src/lib/task-rules.ts";

/* Scheduled tasks could run and not be created, changed or deleted. The
   rules the form and the operation share. */

const minecraft = requireGame("minecraft-java").console;
const valheim = requireGame("valheim").console;
const task = (over: Partial<TaskInput> = {}): TaskInput => ({
  name: "Nightly backup",
  kind: "BACKUP",
  cron: "0 4 * * *",
  payload: "",
  ...over,
});

test("a nightly backup is a sound task", () => {
  assert.deepEqual(validateTask(task(), minecraft), {});
});

test("a schedule has to be one, and not fire every minute", () => {
  assert.match(validateTask(task({ cron: "every night" }), minecraft).cron ?? "", /Not a schedule/);
  assert.match(validateTask(task({ cron: "* * * * *" }), minecraft).cron ?? "", /every five minutes/);
  assert.equal(validateTask(task({ cron: "*/5 * * * *" }), minecraft).cron, undefined);
  assert.match(validateTask(task({ cron: "0 4 31 2 *" }), minecraft).cron ?? "", /never fires/);
});

test("a broadcast or a command needs text, on one line, and a game that can take it", () => {
  assert.match(validateTask(task({ kind: "BROADCAST" }), minecraft).payload ?? "", /message/);
  assert.match(validateTask(task({ kind: "COMMAND", payload: "say a\nstop" }), minecraft).payload ?? "", /one line/i);
  assert.deepEqual(validateTask(task({ kind: "COMMAND", payload: "save-all" }), minecraft), {});
  // Valheim has no console language at all.
  assert.match(validateTask(task({ kind: "BROADCAST", payload: "hi" }), valheim).kind ?? "", /no way to broadcast/);
  assert.match(validateTask(task({ kind: "COMMAND", payload: "x" }), valheim).kind ?? "", /no console/);
});

test("a cleanup keeps a whole number of backups, stored the way the scheduler reads it", () => {
  assert.ok(validateTask(task({ kind: "CLEANUP", payload: "0" }), minecraft).payload);
  assert.ok(validateTask(task({ kind: "CLEANUP", payload: "seven" }), minecraft).payload);
  assert.equal(normaliseTask(task({ kind: "CLEANUP", payload: " 14 " })).payload, "keep 14");
  assert.equal(payloadForForm("CLEANUP", "keep 14"), "14");
  // A backup has no payload, whatever was typed before the kind changed.
  assert.equal(normaliseTask(task({ kind: "BACKUP", payload: "leftover" })).payload, null);
});

test("a name is at least two characters", () => {
  assert.ok(validateTask(task({ name: " x " }), minecraft).name);
});
