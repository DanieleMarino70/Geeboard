import assert from "node:assert/strict";
import { test } from "node:test";
import { createAttemptCounter } from "../src/domain/access/attempt-counter";

/* The counters behind sign-in, the second factor and the setup links are keyed by what a request carries. The audit of 0.9.5 sent a different
   address each time and watched the map grow without a ceiling while every insertion swept all of it. The ceiling is the thing held here. */

test("a key is allowed up to its limit and refused after, and a success forgets it", () => {
  const counter = createAttemptCounter();
  const key = "t:limit";
  for (let i = 0; i < 3; i++) assert.equal(counter.attempt(key, 3, 60_000), true, `try ${i + 1}`);
  assert.equal(counter.attempt(key, 3, 60_000), false);
  assert.equal(counter.exhausted(key, 3), true);
  counter.clear(key);
  assert.equal(counter.exhausted(key, 3), false);
  assert.equal(counter.attempt(key, 3, 60_000), true);
});

test("a window ends: the count starts again", () => {
  let now = 1_000;
  const counter = createAttemptCounter({ now: () => now });
  assert.equal(counter.attempt("k", 1, 1_000), true);
  assert.equal(counter.attempt("k", 1, 1_000), false);
  now += 1_001;
  assert.equal(counter.exhausted("k", 1), false);
  assert.equal(counter.attempt("k", 1, 1_000), true);
});

test("the number of keys has a ceiling, whatever is sent", () => {
  const counter = createAttemptCounter({ max: 1_000 });
  for (let i = 0; i < 5_000; i++) counter.attempt(`flood:${i}`, 1, 15 * 60_000);
  assert.ok(counter.size() <= 1_000, `${counter.size()} keys held after 5000 different ones`);
  assert.ok(counter.size() >= 900, `the ceiling evicts one key per new key, not the whole map: ${counter.size()}`);
});

test("past the ceiling the oldest key goes, and a key still in use keeps its count", () => {
  const counter = createAttemptCounter({ max: 3 });
  counter.attempt("a", 5, 60_000);
  counter.attempt("b", 5, 60_000);
  counter.attempt("c", 5, 60_000);
  counter.attempt("d", 5, 60_000);
  assert.equal(counter.size(), 3);
  assert.equal(counter.exhausted("a", 1), false, "a was the oldest and is gone");
  assert.equal(counter.exhausted("d", 1), true, "d is held");
});

test("a flood of different keys does not make each insertion cost the whole map", () => {
  const counter = createAttemptCounter();
  const started = performance.now();
  for (let i = 0; i < 60_000; i++) counter.attempt(`timed:${i}`, 1, 15 * 60_000);
  const took = performance.now() - started;
  // Sweeping everything on every insertion took seconds for this many (4.7 s per 10 000 at the end); a ceiling and a timed sweep take milliseconds.
  assert.ok(took < 1500, `${Math.round(took)} ms for 60000 insertions`);
});
