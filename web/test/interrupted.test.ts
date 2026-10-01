import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATE_SILENT_MS, createInterrupted, interruptionMessage } from "../src/domain/servers/interrupted.ts";

const now = Date.parse("2026-10-01T12:00:00Z");
const quietFor = (ms: number) => new Date(now - ms);

test("a create that has written in the last ten minutes is alive", () => {
  assert.equal(createInterrupted({ state: "INSTALLING", updatedAt: quietFor(0) }, now), false);
  assert.equal(createInterrupted({ state: "INSTALLING", updatedAt: quietFor(9 * 60_000) }, now), false);
  assert.equal(createInterrupted({ state: "INSTALLING", updatedAt: quietFor(CREATE_SILENT_MS) }, now), false, "exactly ten minutes is still not past it");
});

test("one that has been quiet longer is one nobody is creating", () => {
  assert.equal(createInterrupted({ state: "INSTALLING", updatedAt: quietFor(CREATE_SILENT_MS + 1) }, now), true);
  assert.equal(createInterrupted({ state: "CREATING", updatedAt: quietFor(30 * 60_000) }, now), true);
});

/* Only a create: a server that is stopped, running or crashed is quiet for days
   and is none of this, and the other transitional states — a backup, a move, an
   update — can legitimately take long and have their own handling. */
test("no other state is a create, however long it has been quiet", () => {
  for (const state of ["STOPPED", "RUNNING", "CRASHED", "ERROR", "UNHEALTHY", "UPDATING", "BACKING_UP", "MIGRATING", "STARTING", "STOPPING", "DELETING"] as const) {
    assert.equal(createInterrupted({ state, updatedAt: quietFor(24 * 3600_000) }, now), false, state);
  }
});

test("the ten minutes are longer than anything a live create is silent for", () => {
  // A download is written every 1.5 s and its node is given three minutes before the create fails on its own.
  const longestSilenceOfALiveCreate = 3 * 60_000;
  assert.ok(CREATE_SILENT_MS > 3 * longestSilenceOfALiveCreate);
});

test("the message says where the create was, that the node may hold part of it, and what to do", () => {
  const downloading = interruptionMessage("download");
  assert.match(downloading, /The panel stopped while this server was being created, which was downloading its build/);
  assert.match(downloading, /The node may hold part of it/);
  assert.match(downloading, /Delete it from its Settings page/);
  assert.match(downloading, /create it again/);
  assert.match(interruptionMessage("provision"), /creating it on the node/);
  assert.match(interruptionMessage("start"), /starting it/);
  // A step nobody knows, or none, is left out rather than guessed at.
  assert.doesNotMatch(interruptionMessage(null), /which was/);
  assert.doesNotMatch(interruptionMessage("something-new"), /which was/);
});
