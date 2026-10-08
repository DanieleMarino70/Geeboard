import assert from "node:assert/strict";
import { test } from "node:test";
import { SAYS_BY_LABEL, STATE_META, STATE_SAYS, UNKNOWN_META } from "../src/lib/state-meta.ts";

/* A state is a word, and a word is not enough: Installing, Starting, Crashed and Error each leave a person asking what is happening and what
   to do. Every state has its sentence, so that a new state cannot be added with only a word, and the pill says it wherever the pill is. */

test("every state says what it means, in one sentence", () => {
  for (const state of Object.keys(STATE_META) as Array<keyof typeof STATE_META>) {
    const says = STATE_SAYS[state];
    assert.ok(says && says.length >= 20 && says.length <= 170, `${state}: ${says}`);
    assert.match(says, /\.$/, `${state} ends in a full stop`);
    assert.ok(!/\n/.test(says));
  }
  assert.deepEqual(Object.keys(STATE_SAYS).sort(), Object.keys(STATE_META).sort(), "a state with a word and no sentence, or the other way");
});

test("the states that want something done say what to press or where to look", () => {
  for (const state of ["UNHEALTHY", "CRASHED", "ERROR"] as const) assert.match(STATE_SAYS[state], /Console/, state);
  assert.match(STATE_SAYS.ERROR, /press Start/);
  assert.match(STATE_SAYS.STOPPED, /Start/);
  assert.match(STATE_SAYS.UPDATING, /Roll back/);
});

test("a pill that knows only its label finds the sentence, and the state nobody can see is said too", () => {
  for (const meta of Object.values(STATE_META)) assert.ok(SAYS_BY_LABEL[meta.label], meta.label);
  assert.ok(SAYS_BY_LABEL[UNKNOWN_META.label]);
  assert.equal(new Set(Object.values(STATE_META).map((m) => m.label)).size, Object.keys(STATE_META).length, "two states with one word could not be told apart by it");
});
