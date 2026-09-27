import assert from "node:assert/strict";
import { test } from "node:test";
import { LIFECYCLE_STEPS, REACHED_WITHIN_MS, lifecycleOf, stepIndex, timeLeft } from "../src/domain/nodes/lifecycle.ts";

/* The Add a node dialog's steps, read from the facts the panel holds.
   The bug these exist for: the dialog stopped at "registered" and said
   nothing about approval or about the panel reaching the machine, which
   is where a node that will never take a server was found out. */

const NOW = Date.parse("2026-09-27T12:00:00Z");
const node = (over: Partial<NonNullable<Parameters<typeof lifecycleOf>[0]["node"]>> = {}) => ({
  name: "fra-node-03",
  approved: false,
  lastSeenAt: null,
  lastReachedAt: null,
  reachDetail: null,
  ...over,
});

test("a token nobody has used is waiting, and says how long it is good for", () => {
  const step = lifecycleOf({ state: "waiting", expiresAt: new Date(NOW + 5 * 3_600_000) }, "fra-node-03", NOW);
  assert.equal(step.step, "waiting");
  assert.equal(step.done, false);
  assert.match(step.label, /Waiting for fra-node-03/);
  assert.match(step.detail ?? "", /good for 5 h 0 min/);
});

test("registered and unapproved is pending; the panel's call back changes only the detail", () => {
  const cold = lifecycleOf({ state: "registered", node: node() }, "x", NOW);
  assert.equal(cold.step, "pending");
  assert.match(cold.detail ?? "", /first heartbeat/);
  const warm = lifecycleOf({ state: "registered", node: node({ lastReachedAt: new Date(NOW - 5_000) }) }, "x", NOW);
  assert.equal(warm.step, "pending");
  assert.match(warm.detail ?? "", /can reach it/);
  assert.equal(warm.done, false);
});

test("approved but not reached lately is approved, not in service", () => {
  const never = lifecycleOf({ state: "registered", node: node({ approved: true }) }, "x", NOW);
  assert.equal(never.step, "approved");
  assert.equal(never.done, false);
  const stale = lifecycleOf({ state: "registered", node: node({ approved: true, lastReachedAt: new Date(NOW - REACHED_WITHIN_MS - 1) }) }, "x", NOW);
  assert.equal(stale.step, "approved");
  assert.match(stale.detail ?? "", /reach it again/);
});

test("approved and reached just now is in service, and the dialog may stop asking", () => {
  const live = lifecycleOf({ state: "registered", node: node({ approved: true, lastReachedAt: new Date(NOW - 10_000) }) }, "x", NOW);
  assert.equal(live.step, "online");
  assert.equal(live.done, true);
});

test("a failed call back is said in the panel's own words, whatever the approval", () => {
  const detail = "http://10.0.0.5:8080 fra-node-03 is timed out";
  for (const approved of [false, true]) {
    const step = lifecycleOf({ state: "registered", node: node({ approved, reachDetail: detail }) }, "x", NOW);
    assert.equal(step.step, "unreachable");
    assert.match(step.detail ?? "", /timed out/);
    assert.match(step.detail ?? "", /--advertise/);
    assert.equal(step.done, false, "the next call may get through");
  }
  // A call that got through since is what counts, not an old failure.
  const since = lifecycleOf({ state: "registered", node: node({ approved: true, reachDetail: detail, lastReachedAt: new Date(NOW - 1_000) }) }, "x", NOW);
  assert.equal(since.step, "online");
});

test("expired, revoked and gone are final", () => {
  for (const state of ["expired", "revoked", "gone"] as const) {
    const step = lifecycleOf({ state }, "x", NOW);
    assert.equal(step.step, state);
    assert.equal(step.done, true);
    assert.ok(step.label.length > 10);
  }
});

test("the steps are drawn in order and every state lands on one", () => {
  assert.deepEqual(LIFECYCLE_STEPS.map((s) => s.step), ["waiting", "pending", "approved", "online"]);
  assert.equal(stepIndex("waiting"), 0);
  assert.equal(stepIndex("pending"), 1);
  assert.equal(stepIndex("unreachable"), 1, "registered, and stuck there");
  assert.equal(stepIndex("approved"), 2);
  assert.equal(stepIndex("online"), 3);
  assert.equal(stepIndex("expired"), -1);
});

test("time left reads as a person would say it", () => {
  assert.equal(timeLeft(NOW + 90_000, NOW), "2 min");
  assert.equal(timeLeft(NOW + 23 * 3_600_000 + 30 * 60_000, NOW), "23 h 30 min");
  assert.equal(timeLeft(NOW + 7 * 24 * 3_600_000, NOW), "7 days");
  assert.equal(timeLeft(NOW - 1, NOW), "expired");
});
