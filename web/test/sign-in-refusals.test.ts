import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  AUDIT_ACTION_LABELS,
  REFUSAL_LINES_PER_WINDOW,
  SIGN_IN_ACTOR,
  SIGN_IN_REFUSALS,
  SIGN_IN_REFUSED,
  createRefusalLedger,
  triedAddress,
} from "../src/domain/access/sign-in-refusals";

/* A refused sign-in is a line in the audit log (0.11.0). A stranger causes it, so what bounds it is held here: a ceiling on lines a quarter
   hour, and the "too many attempts" that every request past a limit gets written once and not once per request. */

test("lines are written up to the ceiling, then one says it stopped, then none until the window is out", () => {
  let now = 0;
  const ledger = createRefusalLedger({ limit: 3, windowMs: 1_000, now: () => now });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(() => ledger.decide()), ["write", "write", "write", "stopped", "skip", "skip"]);
  assert.equal(ledger.resumesAt().getTime(), 1_000);
  now = 1_000;
  assert.equal(ledger.decide(), "write");
});

test("a refusal under a key is written once a window, however often it is asked", () => {
  let now = 0;
  const ledger = createRefusalLedger({ limit: 100, windowMs: 1_000, now: () => now });
  assert.equal(ledger.decide("limited:203.0.113.9"), "write");
  for (let i = 0; i < 50; i++) assert.equal(ledger.decide("limited:203.0.113.9"), "skip");
  assert.equal(ledger.decide("limited:198.51.100.7"), "write", "another source is its own");
  now = 1_001;
  assert.equal(ledger.decide("limited:203.0.113.9"), "write");
});

test("a flood of different keys fills the ceiling and no more", () => {
  const ledger = createRefusalLedger();
  const decided = Array.from({ length: REFUSAL_LINES_PER_WINDOW * 4 }, (_, i) => ledger.decide(`limited:10.0.${i >> 8}.${i & 255}`));
  assert.equal(decided.filter((d) => d === "write").length, REFUSAL_LINES_PER_WINDOW);
  assert.equal(decided.filter((d) => d === "stopped").length, 1);
});

test("the address is kept as an address can be, and nothing else", () => {
  assert.equal(triedAddress("  Mara@Ashfold.GG "), "mara@ashfold.gg");
  assert.equal(triedAddress(`${"a".repeat(300)}@x.y`).length, 254);
});

test("the line has a readable name, and every reason a sentence", () => {
  assert.equal(SIGN_IN_REFUSED, "account.signin.refused");
  assert.equal(AUDIT_ACTION_LABELS[SIGN_IN_REFUSED], "Sign-in refused");
  for (const [reason, text] of Object.entries(SIGN_IN_REFUSALS)) assert.match(text, /^[A-Z][a-z-]/, reason);
});

test("the actor it is written under is a name no account can take", () => {
  const source = readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "system-user.ts"), "utf8");
  assert.ok(source.includes(`"${SIGN_IN_ACTOR}"`));
});

test("the documentation names the action", () => {
  const security = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "security.md"), "utf8");
  assert.ok(security.includes(SIGN_IN_REFUSED));
});
