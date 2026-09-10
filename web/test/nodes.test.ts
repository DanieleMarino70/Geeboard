import assert from "node:assert/strict";
import { test } from "node:test";
import { requireGame } from "../src/domain/games/registry.ts";
import type { NodeProfile } from "../src/domain/nodes/compatibility.ts";
import {
  DEGRADED_AFTER_MS,
  UNREACHABLE_AFTER_MS,
  assessHealth,
  silenceLabel,
} from "../src/domain/nodes/health.ts";
import { placeServer } from "../src/domain/nodes/placement.ts";

/* Placement and node health. Both are pure functions of a snapshot, so
   the whole surface is testable without a node, a network or a clock
   that moves. */

function node(overrides: Partial<NodeProfile> = {}): NodeProfile {
  return {
    name: "mil-node-01",
    region: "eu-south",
    state: "HEALTHY",
    pingMs: 12,
    os: "linux",
    arch: "x64",
    capabilities: ["docker", "steamcmd", "java"],
    cpuTotalPct: 1600,
    ramTotalGb: 64,
    diskTotalGb: 1000,
    cpuCommittedPct: 200,
    ramCommittedGb: 8,
    diskCommittedGb: 100,
    servers: 2,
    hasAgent: true,
    ...overrides,
  };
}

const REQUEST = {
  game: requireGame("minecraft-java"),
  resources: { memoryGb: 8, cpuLimit: 300, diskGb: 60 },
};

/* ── Placement ────────────────────────────────────────────────────── */

test("the emptiest compatible node wins", () => {
  const placement = placeServer(REQUEST, [
    node({ name: "busy", ramCommittedGb: 52, servers: 9 }),
    node({ name: "roomy", ramCommittedGb: 8, servers: 1 }),
    node({ name: "middling", ramCommittedGb: 30, servers: 5 }),
  ]);

  assert.equal(placement.recommended?.node, "roomy");
  assert.deepEqual(
    placement.candidates.map((c) => c.node),
    ["roomy", "middling", "busy"],
  );
});

test("a recommendation comes with its arithmetic", () => {
  const placement = placeServer(REQUEST, [node()]);
  const reasons = placement.recommended!.reasons;

  // Not a bare score: a number nobody can reproduce is a number nobody
  // trusts, so the reasons are the output.
  assert.ok(reasons.some((r) => /memory free/.test(r)));
  assert.ok(reasons.some((r) => /CPU free/.test(r)));
  assert.ok(reasons.some((r) => /servers? already here/.test(r)));
});

test("an unapproved node is never recommended", () => {
  const placement = placeServer(REQUEST, [
    node({ name: "waiting", state: "PENDING", ramCommittedGb: 0, servers: 0 }),
    node({ name: "approved", ramCommittedGb: 40, servers: 8 }),
  ]);

  /* The pending node is emptier and would otherwise win outright.
     Approval is a person's decision and placement does not route
     around it. */
  assert.equal(placement.recommended?.node, "approved");
  assert.equal(placement.candidates.find((c) => c.node === "waiting")?.eligible, false);
});

test("draining and maintenance nodes are not placed on", () => {
  for (const state of ["DRAINING", "MAINTENANCE", "UNREACHABLE"] as const) {
    const placement = placeServer(REQUEST, [node({ name: "out", state, ramCommittedGb: 0 })]);
    assert.equal(placement.recommended, null, state);
  }
});

test("a node that cannot fit the server is refused, not ranked low", () => {
  const placement = placeServer(REQUEST, [node({ name: "full", ramCommittedGb: 60 })]);
  assert.equal(placement.recommended, null);
  assert.equal(placement.candidates[0]!.eligible, false);
  assert.ok(placement.candidates[0]!.reasons.some((r) => r.startsWith("Memory")));
});

test("region is a preference and not a requirement", () => {
  const placement = placeServer(
    { ...REQUEST, region: "eu-north" },
    [
      node({ name: "far", region: "us-east", ramCommittedGb: 8 }),
      node({ name: "near", region: "eu-north", ramCommittedGb: 8 }),
    ],
  );

  assert.equal(placement.recommended?.node, "near");
  // The one in the wrong region is still usable — a preference that
  // refuses is a requirement wearing a friendlier word.
  assert.equal(placement.candidates.find((c) => c.node === "far")?.eligible, true);
});

test("a node we are unsure about loses to one we are sure about", () => {
  const placement = placeServer(REQUEST, [
    // Emptier, but has not reported its architecture.
    node({ name: "unknown", arch: null, ramCommittedGb: 0, servers: 0 }),
    node({ name: "known", ramCommittedGb: 16, servers: 3 }),
  ]);

  assert.equal(placement.recommended?.node, "known");
  assert.equal(placement.candidates.find((c) => c.node === "unknown")?.eligible, true);
});

test("placement is deterministic for identical nodes", () => {
  const nodes = [node({ name: "b", pingMs: 20 }), node({ name: "a", pingMs: 20 })];
  const first = placeServer(REQUEST, nodes).candidates.map((c) => c.node);
  const second = placeServer(REQUEST, [...nodes].reverse()).candidates.map((c) => c.node);

  assert.deepEqual(first, second);
  assert.deepEqual(first, ["a", "b"]);
});

test("when nothing fits, the reason is said once rather than per node", () => {
  const placement = placeServer(REQUEST, [
    node({ name: "one", ramCommittedGb: 60 }),
    node({ name: "two", ramCommittedGb: 61 }),
    node({ name: "three", ramCommittedGb: 62 }),
  ]);

  assert.equal(placement.recommended, null);
  assert.ok(placement.refusal);
  assert.equal(placement.refusal.length, 1);
  assert.match(placement.refusal[0]!, /^Every node: memory/);
});

test("an empty fleet says so rather than failing", () => {
  const placement = placeServer(REQUEST, []);
  assert.equal(placement.recommended, null);
  assert.deepEqual(placement.refusal, ["There are no nodes registered."]);
});

/* ── Health ───────────────────────────────────────────────────────── */

const now = new Date("2026-09-11T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

test("one failed request is not a dead machine", () => {
  const outcome = assessHealth({
    current: "HEALTHY",
    lastSeenAt: ago(5_000),
    reachable: false,
    now,
  });

  // A dropped packet, a restarting agent and a dead machine look the
  // same from here. Only one is worth an alarm, so silence has to be
  // long enough to mean something.
  assert.equal(outcome.state, "HEALTHY");
  assert.equal(outcome.changed, false);
  assert.equal(outcome.event, null);
});

test("thirty seconds of silence is degraded", () => {
  const outcome = assessHealth({
    current: "HEALTHY",
    lastSeenAt: ago(DEGRADED_AFTER_MS + 1_000),
    reachable: false,
    now,
  });

  assert.equal(outcome.state, "DEGRADED");
  assert.equal(outcome.event?.action, "node.degraded");
  assert.equal(outcome.event?.tone, "WARNING");
});

test("two minutes of silence is unreachable", () => {
  const outcome = assessHealth({
    current: "DEGRADED",
    lastSeenAt: ago(UNREACHABLE_AFTER_MS + 1_000),
    reachable: false,
    now,
  });

  assert.equal(outcome.state, "UNREACHABLE");
  assert.equal(outcome.event?.action, "node.unreachable");
  assert.equal(outcome.event?.tone, "DANGER");
});

test("recovery is immediate; only the decline is gradual", () => {
  const outcome = assessHealth({
    current: "UNREACHABLE",
    lastSeenAt: ago(UNREACHABLE_AFTER_MS * 10),
    reachable: true,
    now,
  });

  assert.equal(outcome.state, "HEALTHY");
  assert.equal(outcome.event?.action, "node.recovered");
});

test("a node an operator took out of service is left alone", () => {
  for (const state of ["DRAINING", "MAINTENANCE", "PENDING"] as const) {
    const silent = assessHealth({ current: state, lastSeenAt: ago(3600_000), reachable: false, now });
    const answering = assessHealth({ current: state, lastSeenAt: now, reachable: true, now });

    // Neither silence nor a successful ping overrules a decision a
    // person made — reporting maintenance as a fault teaches people to
    // ignore the ones that are real.
    assert.equal(silent.state, state);
    assert.equal(answering.state, state);
    assert.equal(silent.event, null);
  }
});

test("a node never heard from is unreachable, not healthy", () => {
  const outcome = assessHealth({ current: "HEALTHY", lastSeenAt: null, reachable: false, now });
  assert.equal(outcome.state, "UNREACHABLE");
  assert.equal(silenceLabel(outcome.silentForMs), "never heard from");
});

test("no event when nothing changed", () => {
  const outcome = assessHealth({
    current: "UNREACHABLE",
    lastSeenAt: ago(UNREACHABLE_AFTER_MS * 2),
    reachable: false,
    now,
  });
  assert.equal(outcome.changed, false);
  assert.equal(outcome.event, null);
});
