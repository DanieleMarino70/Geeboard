import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKOFF_MAX_MS, HEARTBEAT_MS, failureKind, nextDelay, refusalFix } from "../src/heartbeat-plan.ts";

/* How soon the agent tries the panel again, and what it tells whoever reads its log when the panel will not have it. */

const middle = () => 0.5; // jitter of nothing
const lowest = () => 0;
const highest = () => 0.999999;

test("an answer that was a refusal is told from one that never came", () => {
  assert.equal(failureKind("401 Unknown node."), "refused");
  assert.equal(failureKind("403 forbidden"), "refused");
  assert.equal(failureKind("404 Not Found"), "refused");
  // A 500, a 503 and the network's own sentences are the panel being away, not refusing.
  assert.equal(failureKind("500 Internal Server Error"), "network");
  assert.equal(failureKind("503 Service Unavailable"), "network");
  assert.equal(failureKind("nothing is listening at https://panel.example.test. (ECONNREFUSED)"), "network");
  assert.equal(failureKind("https://panel.example.test did not answer within 10 seconds."), "network");
});

test("a beat that got through is the interval, and a refusal waits five minutes", () => {
  assert.equal(nextDelay(0, null, middle), HEARTBEAT_MS);
  assert.equal(nextDelay(0, "network", middle), HEARTBEAT_MS);
  assert.equal(nextDelay(1, "refused", middle), BACKOFF_MAX_MS);
  assert.equal(nextDelay(40, "refused", middle), BACKOFF_MAX_MS);
});

test("a network failure doubles from the interval up to five minutes, and stays there", () => {
  const waits = [1, 2, 3, 4, 5, 6, 20].map((n) => nextDelay(n, "network", middle));
  assert.deepEqual(waits, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
});

test("jitter is a fifth either way for the network and a tenth for a refusal, and never makes it shorter than the interval", () => {
  assert.equal(nextDelay(3, "network", lowest), 96_000);
  assert.ok(nextDelay(3, "network", highest) <= 144_000);
  assert.equal(nextDelay(1, "refused", lowest), 270_000);
  assert.ok(nextDelay(1, "refused", highest) <= 330_000);
  for (let n = 1; n < 12; n++) assert.ok(nextDelay(n, "network", lowest) >= HEARTBEAT_MS);
});

test("what a refusal says is an instruction, and a 404 is not blamed on the node's token", () => {
  assert.match(refusalFix("401 Unknown node."), /Join again with a new token/);
  assert.match(refusalFix("401 Unknown node."), /restored from an older backup/);
  assert.match(refusalFix("404 Not Found"), /not a Geeboard panel of this release/);
  assert.doesNotMatch(refusalFix("404 Not Found"), /token/);
});
