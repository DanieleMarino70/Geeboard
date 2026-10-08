import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMAND_NOT_SHOWN, changesFor, payloadHidden, type CommandReader } from "../src/domain/access/commands";
import { SERVER_OPERATION_PERMISSION } from "../src/domain/access/operations";
import { SCOPE_PERMISSIONS } from "../src/domain/access/permissions";
import { TASK_KINDS, TASK_KIND_IS_COMMAND, TASK_KIND_PERMISSION } from "../src/lib/task-rules";

/* A task does what its kind stands for, so making, changing, running or pausing one asks for the permission of that act: the audit of 0.9.5
   found `servers:write` (which restarts a server at night) carrying a console command and the deletion of backups through a task. */

test("every kind of task names the permission of what it does, and the permission is a real one", () => {
  const known = new Set(Object.values(SCOPE_PERMISSIONS).flat());
  assert.deepEqual(Object.keys(TASK_KIND_PERMISSION).sort(), [...TASK_KINDS].sort());
  for (const kind of TASK_KINDS) assert.ok(known.has(TASK_KIND_PERMISSION[kind]), `${kind}: ${TASK_KIND_PERMISSION[kind]} is in no scope`);
});

test("what a task types is held to the console, what it restarts to the restart, what it keeps or deletes to the backups", () => {
  assert.equal(TASK_KIND_PERMISSION.COMMAND, SERVER_OPERATION_PERMISSION.consoleCommand);
  assert.equal(TASK_KIND_PERMISSION.BROADCAST, SERVER_OPERATION_PERMISSION.consoleCommand);
  assert.equal(TASK_KIND_PERMISSION.RESTART, SERVER_OPERATION_PERMISSION.restart);
  for (const kind of ["BACKUP", "CLEANUP", "VERIFY"] as const) assert.equal(TASK_KIND_PERMISSION[kind], "server.backup.write", kind);
});

test("the kinds that carry typed text are the kinds that need the console", () => {
  for (const kind of TASK_KINDS) assert.equal(TASK_KIND_IS_COMMAND[kind], TASK_KIND_PERMISSION[kind] === "server.console.write", kind);
});

const line = { action: "task.created", server: { ownerId: "owner-1" }, changes: { Kind: { from: "—", to: "Console command" }, Payload: { from: "—", to: "op attacker" } } };
const reader = (reach: CommandReader["reach"], id = "reader-1"): CommandReader => ({ id, reach });

test("a reader who may not watch the console reads that a task was made, and not the text it types", () => {
  const seen = changesFor(reader("none"), line) as Record<string, { to: string }>;
  assert.equal(seen.Payload!.to, COMMAND_NOT_SHOWN);
  assert.equal(seen.Kind!.to, "Console command");
  assert.ok(payloadHidden(reader("none"), line));
});

test("the owner of the server and anybody who may watch every console read it", () => {
  assert.deepEqual(changesFor(reader("all"), line), line.changes);
  assert.deepEqual(changesFor(reader("own", "owner-1"), line), line.changes);
  assert.equal((changesFor(reader("own", "somebody-else"), line) as Record<string, { to: string }>).Payload!.to, COMMAND_NOT_SHOWN);
});

test("only the lines that made or changed a task are touched, and a line with no text keeps its changes", () => {
  const other = { action: "settings.updated", server: { ownerId: "owner-1" }, changes: { Payload: { from: "a", to: "b" } } };
  assert.equal(payloadHidden(reader("none"), other), false);
  assert.deepEqual(changesFor(reader("none"), other), other.changes);
  const plain = { action: "task.updated", server: { ownerId: "owner-1" }, changes: { Schedule: { from: "0 4 * * *", to: "0 5 * * *" } } };
  assert.deepEqual(changesFor(reader("none"), plain), plain.changes);
  assert.equal(changesFor(reader("none"), { action: "task.updated", changes: null }), null);
});
