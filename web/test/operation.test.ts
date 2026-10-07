import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BEAT_MS,
  HELD_BY_OPERATION,
  OPERABLE,
  OPERATIONS,
  OPERATION_STATE,
  STALE_MS_DEFAULT,
  busyReason,
  interruption,
  isSilent,
  refusalFor,
} from "../src/domain/servers/operation.ts";

/* Who holds a server, what is said to the one that cannot have it, and what becomes of a server whose operation was cut short. */

const NOW = Date.parse("2026-10-07T03:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

test("every operation puts the server in a state an operation owns, and starts from a settled one", () => {
  for (const operation of OPERATIONS) {
    assert.ok(HELD_BY_OPERATION.includes(OPERATION_STATE[operation]), operation);
  }
  assert.equal(OPERATION_STATE.backup, "BACKING_UP");
  assert.equal(OPERATION_STATE.move, "MIGRATING");
  for (const state of OPERABLE) assert.ok(!HELD_BY_OPERATION.includes(state), state);
  // A server that is still being made, or being removed, or taken out of service on purpose, is not one to begin an operation on.
  for (const state of ["CREATING", "INSTALLING", "STARTING", "STOPPING", "DELETING", "SUSPENDED", "BACKING_UP", "UPDATING", "MIGRATING"] as const) {
    assert.ok(!OPERABLE.includes(state), state);
  }
  // And ERROR is, because a rebuild or a restore is how a server comes back from one.
  assert.ok(OPERABLE.includes("ERROR"));
});

test("the one that cannot have the server is told what has it, and for how long", () => {
  const backing = busyReason({ state: "BACKING_UP", operation: "backup", operationStartedAt: ago(1_000) }, NOW);
  assert.equal(backing, "Busy: a backup has been running for 1 s.");
  assert.equal(busyReason({ state: "UPDATING", operation: "update", operationStartedAt: ago(4 * 60_000) }, NOW), "Busy: an update has been running for 4 min.");
  assert.equal(busyReason({ state: "UPDATING", operation: "settings", operationStartedAt: ago(10_000) }, NOW), "Busy: a settings rebuild has been running for 10 s.");
  // A row from before the columns existed has a state and no operation: still said, without the name it does not have.
  assert.equal(busyReason({ state: "MIGRATING", operation: null, operationStartedAt: null }, NOW), "Busy: a move is running.");
  assert.equal(busyReason({ state: "STARTING", operation: null, operationStartedAt: null }, NOW), "Busy: it is starting.");
  assert.equal(busyReason({ state: "SUSPENDED", operation: null, operationStartedAt: null }, NOW), "Busy: it is suspended.");
  assert.equal(busyReason({ state: "RUNNING", operation: null, operationStartedAt: null }, NOW), "Not now: it is running.");
});

test("delete, start, stop and restart are refused when they are another operation's moment, and not otherwise", () => {
  const at = (state: Parameters<typeof busyReason>[0]["state"], operation: string | null = null) => ({ state, operation, operationStartedAt: operation ? ago(5_000) : null });
  for (const action of ["start", "stop", "restart", "delete"] as const) {
    for (const state of HELD_BY_OPERATION) {
      assert.match(refusalFor(action, at(state, "update"), NOW) ?? "", /^Busy: /, `${action} ${state}`);
    }
  }
  assert.equal(refusalFor("delete", at("RUNNING"), NOW), null);
  assert.equal(refusalFor("delete", at("ERROR"), NOW), null);
  // A server that is stuck being made can be got rid of: that is how a creation that went wrong ends.
  assert.equal(refusalFor("delete", at("INSTALLING"), NOW), null);
  assert.equal(refusalFor("delete", at("CREATING"), NOW), null);
  assert.match(refusalFor("delete", at("DELETING"), NOW) ?? "", /being deleted/);
  assert.equal(refusalFor("stop", at("STARTING"), NOW), null, "a server that is starting may be stopped");
  assert.match(refusalFor("stop", at("INSTALLING"), NOW) ?? "", /installing/);
  assert.match(refusalFor("start", at("STOPPING"), NOW) ?? "", /stopping/);
  assert.equal(refusalFor("start", at("STOPPED"), NOW), null);
  assert.equal(refusalFor("restart", at("RUNNING"), NOW), null);
});

test("a backup that was cut short gives the server back as it was; everything else is an error with a way out", () => {
  const backup = interruption("backup", "RUNNING", { kind: "restarted", process: "panel" });
  assert.equal(backup.state, "RUNNING");
  assert.equal(backup.lastError, null);
  assert.match(backup.sentence, /^A backup did not finish: The panel was stopped while it ran\. The server was not changed and is running again/);

  // The state before can never be one an operation owns, whatever was stored.
  assert.equal(interruption("backup", "BACKING_UP", { kind: "restarted", process: "poller" }).state, "STOPPED");
  assert.equal(interruption("backup", null, { kind: "restarted", process: "poller" }).state, "STOPPED");

  for (const operation of ["update", "rollback", "rebuild", "settings", "restore"]) {
    const cut = interruption(operation, "RUNNING", { kind: "restarted", process: "panel" });
    assert.equal(cut.state, "ERROR", operation);
    assert.equal(cut.lastError, cut.sentence, "the page shows lastError, and it is the sentence");
    assert.match(cut.sentence, /rebuild it to bring it back, or restore a backup/, operation);
  }
  const moved = interruption("move", "RUNNING", { kind: "silent", ms: 12 * 60_000 });
  assert.equal(moved.state, "ERROR");
  assert.match(moved.sentence, /^A move did not finish: nothing has said it is alive for 12 min\./);
  assert.match(moved.sentence, /still on its old node/);
  assert.match(interruption("update", "RUNNING", { kind: "restarted", process: "poller" }).sentence, /The watchdog was stopped while it ran/);
  // A row with no operation name (written before the columns) still gets a sentence.
  assert.match(interruption(null, null, { kind: "silent", ms: 400_000 }).sentence, /^An operation did not finish/);
});

test("silence is measured from the last beat, and from when the row was touched when there was none", () => {
  assert.equal(BEAT_MS, 30_000);
  assert.equal(STALE_MS_DEFAULT, 5 * 60_000);
  assert.equal(isSilent(ago(60_000), ago(3_600_000), NOW, STALE_MS_DEFAULT), false, "a beat a minute ago");
  assert.equal(isSilent(ago(6 * 60_000), ago(0), NOW, STALE_MS_DEFAULT), true, "a beat six minutes ago, whatever else touched the row");
  assert.equal(isSilent(null, ago(6 * 60_000), NOW, STALE_MS_DEFAULT), true, "no beat at all: a row from before this existed");
  assert.equal(isSilent(null, ago(60_000), NOW, STALE_MS_DEFAULT), false);
  assert.equal(isSilent(ago(5 * 60_000), ago(0), NOW, STALE_MS_DEFAULT), false, "exactly the allowance is not yet silence");
});
