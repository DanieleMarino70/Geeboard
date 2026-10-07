import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESTART_POLICY_LABELS,
  STABLE_AFTER_MS,
  backoffFor,
  decideAfterStop,
  decideRecovery,
  endedBySignal,
  leftStoppedReason,
  shouldForgiveAttempts,
  stableWindowFor,
  stopEvidence,
  type RecoveryInput,
  type StopRecoveryInput,
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

/* A server the machine stopped. A reboot or Docker restarting ends every container
   with SIGTERM, or SIGKILL when the game does not answer, and the agent reads those
   exit codes as an ordinary stop on purpose; so after every reboot every server was
   down and none came back, whatever its restart policy said. */

/* Measured on a real machine, and the reason this is evidence and not a verdict: a Minecraft server that Docker
   stops with SIGTERM exits with code 0, the code of the game quitting by itself. */

test("a signal in the exit code is evidence the machine or Docker did it, and its absence is not evidence of anything", () => {
  for (const code of [143, 137, 130]) assert.ok(endedBySignal(code), String(code));
  assert.ok(!endedBySignal(0));
  assert.ok(!endedBySignal(null));
  assert.equal(stopEvidence(143, 1), "signal");
  assert.equal(stopEvidence(0, 1), "none");
});

test("a node's servers stopping in the same pass is evidence of the machine, and one stopping alone is not", () => {
  assert.equal(stopEvidence(0, 2), "together");
  assert.equal(stopEvidence(0, 5), "together");
  assert.equal(stopEvidence(null, 1), "none");
  assert.equal(stopEvidence(137, 4), "signal", "its own signal is the stronger claim");
});

function after(overrides: Partial<StopRecoveryInput> = {}): StopRecoveryInput {
  return { policy: "ALWAYS", attempts: 0, maxRestarts: 3, lastRestartAt: null, evidence: "signal", now, ...overrides };
}

test("restart whenever it stops means it, and the start after a reboot is immediate", () => {
  const decision = decideAfterStop(after());
  assert.equal(decision.action, "restart");
  assert.match(decision.reason, /Docker or the machine stopped it/);
  assert.match(decision.reason, /restart whenever it stops/);
});

test("a server that stopped with nothing to say why is restarted too under always, and does not claim a cause", () => {
  const decision = decideAfterStop(after({ evidence: "none" }));
  assert.equal(decision.action, "restart");
  assert.equal(decision.attempt, 1);
  assert.match(decision.reason, /did not ask it to/);
  assert.doesNotMatch(decision.reason, /machine/);
});

test("with nothing to say why it has the same ceiling and the same growing delays as a crash", () => {
  assert.equal(decideAfterStop(after({ evidence: "none", attempts: 3 })).action, "give-up");
  const waiting = decideAfterStop(after({ evidence: "none", attempts: 1, lastRestartAt: ago(5_000) }));
  assert.equal(waiting.action, "wait");
  assert.equal(waiting.waitMs, backoffFor(1) - 5_000);
  assert.equal(decideAfterStop(after({ evidence: "none", attempts: 1, lastRestartAt: ago(backoffFor(1) + 1) })).action, "restart");
  assert.match(decideAfterStop(after({ evidence: "none", attempts: 1, lastRestartAt: ago(1_000_000) })).reason, /again; restart 2 of 3/);
});

/* Measured on a real machine: two restarts of it within minutes of each other left an always server on restart 2 of 3,
   and a third would have put it in ERROR as a crash loop. A machine that restarts is not one. */

test("a stop the machine did is not a crash loop: no ceiling, no delay, and the budget is not used", () => {
  for (const evidence of ["signal", "together"] as const) {
    const first = decideAfterStop(after({ evidence }));
    assert.equal(first.action, "restart", evidence);
    assert.equal(first.attempt, 0, "the attempts are what they were");
    const third = decideAfterStop(after({ evidence, attempts: 3, lastRestartAt: ago(1_000) }));
    assert.equal(third.action, "restart", `${evidence}: past the ceiling and inside the delay`);
    assert.equal(third.attempt, 3);
  }
  assert.match(decideAfterStop(after({ evidence: "together" })).reason, /together with the other servers of its node/);
});

test("on-failure and never are not restarted whatever the evidence", () => {
  for (const policy of ["ON_FAILURE", "NEVER"] as const) {
    for (const evidence of ["signal", "together", "none"] as const) assert.equal(decideAfterStop(after({ policy, evidence })).action, "ignore", `${policy} ${evidence}`);
  }
});

test("on-failure and never leave a server that stopped without being asked", () => {
  for (const policy of ["ON_FAILURE", "NEVER"] as const) {
    const decision = decideAfterStop(after({ policy }));
    assert.equal(decision.action, "ignore", policy);
    assert.match(decision.reason, /left stopped/);
    assert.match(decision.reason, /Start it from this page/);
    assert.ok(decision.reason.includes(RESTART_POLICY_LABELS[policy]), "it names the policy it is held to");
  }
});

/* What the page and the message say about why, by what there is evidence for. */

const reasonOf = (over: Partial<Parameters<typeof leftStoppedReason>[0]> = {}) =>
  leftStoppedReason({ policy: "ON_FAILURE", evidence: "none", node: "fra-node-02", others: 0, ...over });

test("a signal is said to be Docker or the machine, and the policy and the way out follow", () => {
  const text = reasonOf({ evidence: "signal" });
  assert.match(text, /^Docker or the machine stopped it/);
  assert.match(text, /restart policy is "Restart after a crash"/i);
  assert.match(text, /Start it from this page\.$/);
});

test("servers that stopped together say how many and where, and that it points at the machine, which is not the same as saying it was", () => {
  assert.match(reasonOf({ evidence: "together", others: 2 }), /^It stopped together with 2 other servers on fra-node-02, which points at the machine or Docker restarting\./);
  assert.match(reasonOf({ evidence: "together", others: 1 }), /together with 1 other server on /);
});

test("a server that stopped alone says nothing is known, and lists what it may have been without choosing", () => {
  const text = reasonOf();
  assert.match(text, /^The panel did not stop it and nothing says why/);
  assert.match(text, /quit by itself/);
  assert.match(text, /machine or Docker may have restarted/);
  assert.doesNotMatch(text, /^Docker or the machine stopped it/);
});

test("what the game said when it stopped replaces the guess", () => {
  const text = reasonOf({ evidence: "together", others: 3, known: "The world could not be loaded: Level.dat is missing." });
  assert.match(text, /^The world could not be loaded: Level\.dat is missing\. Its restart policy is /);
  assert.doesNotMatch(text, /together/);
});

test("the policy it names is the one the server has", () => {
  assert.match(reasonOf({ policy: "NEVER" }), /"Never restart"/);
});
