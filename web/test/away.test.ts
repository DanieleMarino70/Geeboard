import assert from "node:assert/strict";
import { test } from "node:test";
import { awayReasonForControls, awaySentence, nodeAway, nodeSilent } from "../src/domain/nodes/away.ts";
import { FAST_FOR_MS, FAST_MS, GIVE_UP_MS, SLOW_MS, nextRefreshIn } from "../src/domain/refresh.ts";
import { OPTIMISTIC_STATE, STATE_META, UNKNOWN_META } from "../src/lib/state-meta.ts";

/* A node the panel cannot see, what a page says of its servers, and how a page that is waiting keeps itself current. */

const reached = new Date("2026-10-07T12:03:00Z");

test("a node that is degraded or unreachable is away, with the last time it was reached; one that answers is not", () => {
  assert.deepEqual(nodeAway({ state: "UNREACHABLE", lastReachedAt: reached }), { reason: "unreachable", since: reached });
  assert.deepEqual(nodeAway({ state: "DEGRADED", lastReachedAt: reached }), { reason: "degraded", since: reached });
  assert.deepEqual(nodeAway({ state: "UNREACHABLE", lastReachedAt: null }), { reason: "unreachable", since: null });
  for (const state of ["HEALTHY", "DRAINING", "MAINTENANCE", "PENDING"]) assert.equal(nodeAway({ state, lastReachedAt: reached }), null, state);
});

test("what is said of an away node names it, and the controls say why they do nothing", () => {
  const unreachable = nodeAway({ state: "UNREACHABLE", lastReachedAt: reached })!;
  const degraded = nodeAway({ state: "DEGRADED", lastReachedAt: reached })!;
  assert.equal(awaySentence("fra-node-02", unreachable), "fra-node-02 is unreachable");
  assert.equal(awaySentence("fra-node-02", degraded), "fra-node-02 is not answering");
  assert.equal(
    awayReasonForControls("fra-node-02", unreachable),
    "fra-node-02 is unreachable, so its servers cannot be controlled from here until it answers again.",
  );
});

test("a server the panel cannot see reads as unknown, in a tone that is no state's, and never as running", () => {
  assert.equal(UNKNOWN_META.label, "Unknown");
  assert.equal(UNKNOWN_META.pulse, false);
  assert.ok(!Object.values(STATE_META).some((m) => m.label === UNKNOWN_META.label));
  assert.notEqual(UNKNOWN_META.tone, STATE_META.RUNNING.tone);
});

test("a press of Start, Stop or Restart is a state the pill can say at once, and each is a transitional one", () => {
  assert.deepEqual(OPTIMISTIC_STATE, { start: "STARTING", stop: "STOPPING", restart: "RESTARTING" });
  for (const state of Object.values(OPTIMISTIC_STATE)) assert.equal(STATE_META[state].pulse, true, state);
});

test("a page that is waiting draws itself every five seconds, then every fifteen, and stops after ten minutes", () => {
  assert.equal(nextRefreshIn(0), FAST_MS);
  assert.equal(nextRefreshIn(FAST_FOR_MS - 1), FAST_MS);
  assert.equal(nextRefreshIn(FAST_FOR_MS), SLOW_MS);
  assert.equal(nextRefreshIn(GIVE_UP_MS), SLOW_MS);
  assert.equal(nextRefreshIn(GIVE_UP_MS + 1), null);
  assert.ok(FAST_MS < SLOW_MS && FAST_FOR_MS < GIVE_UP_MS);
});

test("a node that was drained and then died is silent, though its state still says draining", () => {
  const now = new Date("2026-10-07T12:30:00Z");
  const old = new Date("2026-10-07T12:03:00Z");
  const fresh = new Date("2026-10-07T12:29:30Z");
  assert.equal(nodeSilent({ state: "UNREACHABLE", lastReachedAt: fresh }, now), true);
  assert.equal(nodeSilent({ state: "DRAINING", lastReachedAt: old }, now), true);
  assert.equal(nodeSilent({ state: "MAINTENANCE", lastReachedAt: null }, now), true);
  assert.equal(nodeSilent({ state: "DRAINING", lastReachedAt: fresh }, now), false);
  // Degraded is a node that has missed a beat or two; healthy and pending are not gone.
  for (const state of ["HEALTHY", "DEGRADED", "PENDING"]) assert.equal(nodeSilent({ state, lastReachedAt: old }, now), false, state);
});
