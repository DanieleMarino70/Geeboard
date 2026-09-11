import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STABLE_AFTER_MS,
  backoffFor,
  decideRecovery,
  shouldForgiveAttempts,
  stableWindowFor,
  type RecoveryInput,
} from "../src/domain/servers/recovery.ts";

/* Crash recovery. The easy half is restarting; the half worth testing
   is knowing when to stop, because the failure mode is a machine
   spending all night starting and killing the same broken process. */

const now = new Date("2026-09-11T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

function input(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
  return {
    state: "CRASHED",
    policy: "ON_FAILURE",
    attempts: 0,
    maxRestarts: 3,
    lastRestartAt: null,
    exitCode: 1,
    oomKilled: false,
    now,
    ...overrides,
  };
}

test("the first restart is immediate", () => {
  const decision = decideRecovery(input());

  // The overwhelmingly common crash is a one-off. Making somebody wait
  // thirty seconds for that is worse service for no safety.
  assert.equal(decision.action, "restart");
  assert.equal(decision.attempt, 1);
  assert.equal(backoffFor(0), 0);
});

test("a server that has not crashed is left alone", () => {
  for (const state of ["RUNNING", "STOPPED", "STOPPING", "UPDATING"] as const) {
    assert.equal(decideRecovery(input({ state })).action, "ignore", state);
  }
});

test("a policy of never means never", () => {
  const decision = decideRecovery(input({ policy: "NEVER" }));
  assert.equal(decision.action, "ignore");
  assert.match(decision.reason, /off for this server/);
});

test("on-failure ignores a clean exit nobody asked for", () => {
  /* Exit zero is a process that chose to stop. Starting it again would
     fight whatever decided to; ALWAYS is the policy for that. */
  assert.equal(decideRecovery(input({ exitCode: 0 })).action, "ignore");
  assert.equal(decideRecovery(input({ exitCode: 0, policy: "ALWAYS" })).action, "restart");
});

test("an out-of-memory kill is never retried", () => {
  const decision = decideRecovery(input({ oomKilled: true, exitCode: 137 }));

  /* The one cause where restarting is actively wrong: the server asked
     for more than it was given, and starting it produces the same kill
     on a loop until somebody raises the limit. */
  assert.equal(decision.action, "give-up");
  assert.match(decision.reason, /ran out of memory/);
});

test("an out-of-memory kill is refused even on the first attempt", () => {
  assert.equal(decideRecovery(input({ oomKilled: true, attempts: 0 })).action, "give-up");
});

test("attempts have a ceiling", () => {
  const decision = decideRecovery(input({ attempts: 3, maxRestarts: 3, lastRestartAt: ago(3600_000) }));

  assert.equal(decision.action, "give-up");
  assert.match(decision.reason, /crashed 3 times in a row/);
});

test("the delay between attempts grows", () => {
  // A second crash means the first restart fixed nothing, so waiting
  // longer is the only thing that distinguishes retrying from thrashing.
  assert.ok(backoffFor(1) > backoffFor(0));
  assert.ok(backoffFor(2) > backoffFor(1));
  assert.ok(backoffFor(3) > backoffFor(2));
  // And it stops growing rather than reaching into next week.
  assert.equal(backoffFor(9), backoffFor(3));
});

test("a restart too soon after the last one waits instead", () => {
  const decision = decideRecovery(input({ attempts: 1, lastRestartAt: ago(5_000) }));

  assert.equal(decision.action, "wait");
  assert.ok(decision.waitMs! > 0);
  assert.ok(decision.waitMs! <= backoffFor(1));
});

test("once the delay has passed, it restarts", () => {
  const decision = decideRecovery(input({ attempts: 1, lastRestartAt: ago(backoffFor(1) + 1_000) }));

  assert.equal(decision.action, "restart");
  assert.equal(decision.attempt, 2);
  assert.match(decision.reason, /restart 2 of 3/);
});

test("a server that has stayed up gets its budget back", () => {
  /* Without this, a server that falls over once a month would
     eventually exhaust its attempts and stay down — the count has to
     mean "crashing now", not "has ever crashed". */
  assert.equal(shouldForgiveAttempts("RUNNING", ago(STABLE_AFTER_MS + 1_000), 2, 0, now), true);
  assert.equal(shouldForgiveAttempts("RUNNING", ago(STABLE_AFTER_MS - 1_000), 2, 0, now), false);
});

test("a slow-booting game needs longer before it counts as stable", () => {
  /* Rust generates its map for twenty minutes. Forgiving its attempts
     at ten would reset the budget while the server was still starting,
     which means a crash loop that never runs out of attempts. */
  const rustBoot = 1200;
  assert.ok(stableWindowFor(rustBoot) > rustBoot * 1000);
  assert.equal(shouldForgiveAttempts("RUNNING", ago(15 * 60_000), 2, rustBoot, now), false);
  assert.equal(shouldForgiveAttempts("RUNNING", ago(45 * 60_000), 2, rustBoot, now), true);
});

test("only a server that is actually up is forgiven", () => {
  const longAgo = ago(STABLE_AFTER_MS * 10);

  assert.equal(shouldForgiveAttempts("CRASHED", longAgo, 2, 0, now), false);
  assert.equal(shouldForgiveAttempts("UNHEALTHY", longAgo, 2, 0, now), false);
  // Nothing to forgive.
  assert.equal(shouldForgiveAttempts("RUNNING", longAgo, 0, 0, now), false);
  // Never started, so no run to have lasted.
  assert.equal(shouldForgiveAttempts("RUNNING", null, 2, 0, now), false);
});

test("no shipped game can be forgiven while it is still booting", async () => {
  const { allGames } = await import("../src/domain/games/registry.ts");

  /* A server that is merely still booting must not be mistaken for one
     that has recovered — otherwise a crash loop resets its own budget
     every time it gets as far as starting. */
  for (const game of allGames()) {
    const boot = game.health.bootGraceSeconds;
    assert.ok(
      stableWindowFor(boot) > boot * 1000,
      `${game.id} boots for ${boot}s but would be stable at ${stableWindowFor(boot) / 1000}s`,
    );
  }
});
