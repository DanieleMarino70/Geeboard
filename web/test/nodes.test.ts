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
import { retirementOf } from "../src/domain/nodes/retirement.ts";

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

/* Anti-affinity: a preference about neighbours. It decides between nodes
   that both have room, and never outvotes one that has none. */

const mine = { gameId: "minecraft-java", ownerId: "mara" };
const theirs = { gameId: "minecraft-java", ownerId: "someone-else" };
const myTerraria = { gameId: "terraria", ownerId: "mara" };

test("of two equal nodes, the one without a server of the same game wins, and says why", () => {
  const placement = placeServer({ ...REQUEST, ownerId: "mara" }, [
    node({ name: "a-has-one", hosted: [theirs, { gameId: "terraria", ownerId: "x" }] }),
    node({ name: "b-has-none", hosted: [{ gameId: "terraria", ownerId: "x" }, { gameId: "valheim", ownerId: "y" }] }),
  ]);

  // Without the term the tiebreak is the name, and a-has-one would win.
  assert.equal(placement.recommended?.node, "b-has-none");
  const loser = placement.candidates.find((c) => c.node === "a-has-one")!;
  assert.ok(loser.reasons.some((r) => /1 other Minecraft: Java Edition server here, which would go down with it/.test(r)), loser.reasons.join(" | "));
  assert.ok(placement.recommended!.reasons.some((r) => /No other Minecraft: Java Edition server here, and none of this owner's/.test(r)));
});

test("an owner's other servers count for half a same-game neighbour, and once each", () => {
  const score = (hosted: NonNullable<NodeProfile["hosted"]>) =>
    placeServer({ ...REQUEST, ownerId: "mara" }, [node({ hosted })]).recommended!.score;

  const none = score([{ gameId: "valheim", ownerId: "x" }, { gameId: "valheim", ownerId: "y" }]);
  const ownersOther = score([myTerraria, { gameId: "valheim", ownerId: "y" }]);
  const sameGame = score([theirs, { gameId: "valheim", ownerId: "y" }]);
  // The owner's own Minecraft server is a same-game neighbour, not that and an owner's too.
  const both = score([mine, { gameId: "valheim", ownerId: "y" }]);

  assert.ok(none > ownersOther && ownersOther > sameGame, `${none} ${ownersOther} ${sameGame}`);
  assert.equal(both, sameGame);
});

test("the first neighbour of a kind costs the most", () => {
  const score = (count: number) =>
    placeServer(REQUEST, [node({ servers: 4, hosted: Array.from({ length: 4 }, (_, i) => (i < count ? theirs : myTerraria)) })]).recommended!.score;
  const [zero, one, two, three] = [score(0), score(1), score(2), score(3)];
  assert.ok(zero - one > one - two && one - two > two - three, `${zero} ${one} ${two} ${three}`);
});

test("anti-affinity never outvotes capacity", () => {
  const placement = placeServer({ ...REQUEST, ownerId: "mara" }, [
    // Plenty of room, and two of the same game already here.
    node({ name: "roomy", ramCommittedGb: 8, hosted: [mine, theirs] }),
    // None of the same game, and nearly full.
    node({ name: "full", ramCommittedGb: 54, cpuCommittedPct: 1200, hosted: [myTerraria] }),
  ]);
  assert.equal(placement.recommended?.node, "roomy");
});

test("a node nobody described is scored as if it had no such neighbours", () => {
  const described = placeServer(REQUEST, [node({ hosted: [] })]).recommended!;
  const undescribed = placeServer(REQUEST, [node({ hosted: undefined })]).recommended!;
  assert.equal(described.score, undescribed.score);
  assert.ok(!undescribed.reasons.some((r) => /Minecraft/.test(r)));
});

test("the same fleet always places the same way", () => {
  const fleet = [node({ name: "b", hosted: [theirs] }), node({ name: "a", hosted: [theirs] }), node({ name: "c", hosted: [mine, theirs] })];
  const first = placeServer({ ...REQUEST, ownerId: "mara" }, fleet).candidates.map((c) => `${c.node}:${c.score}`);
  const again = placeServer({ ...REQUEST, ownerId: "mara" }, [...fleet].reverse()).candidates.map((c) => `${c.node}:${c.score}`);
  assert.deepEqual(first, again);
});

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

test("a recommended node's reasons say which of them count against it", () => {
  // The only node there is, degraded, with no agent, in another region, next to one of its own kind.
  const placement = placeServer({ ...REQUEST, region: "eu-west", ownerId: "mara" }, [
    node({ state: "DEGRADED", hasAgent: false, region: "us-east", hosted: [theirs] }),
  ]);
  const { reasons, against } = placement.recommended!;
  assert.deepEqual(against, [
    "1 other Minecraft: Java Edition server here, which would go down with it",
    "Not in eu-west",
    "Node healthy: It is degraded — a placement here may not settle.",
    "Agent attached: No agent on this node, so the server would be simulated.",
  ]);
  // Every one of them is also a reason, and the rest are not against it.
  assert.ok(against.every((r) => reasons.includes(r)));
  assert.ok(!against.some((r) => /memory free|CPU free/.test(r)));
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

test("a refusal that is not about capacity says what is missing, not which check", () => {
  const valheim = { game: requireGame("valheim"), resources: { memoryGb: 4, cpuLimit: 200, diskGb: 20 } };
  const placement = placeServer(valheim, [
    node({ name: "one", capabilities: ["docker"] }),
    node({ name: "two", capabilities: ["docker", "ipv6"] }),
  ]);
  assert.equal(placement.recommended, null);
  assert.ok(placement.refusal!.some((r) => /^Every node: missing SteamCMD/.test(r)), JSON.stringify(placement.refusal));
});

/* Minecraft's image carries its own Java. Asking the node for it refused
   a machine with Docker and nothing else, as the PC this was first run on
   registered itself. */
test("Minecraft needs Docker from a node, not Java", () => {
  const placement = placeServer(REQUEST, [node({ name: "plain", capabilities: ["docker"] })]);
  assert.equal(placement.recommended?.node, "plain");
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
    lastReachedAt: ago(5_000),
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
    lastReachedAt: ago(DEGRADED_AFTER_MS + 1_000),
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
    lastReachedAt: ago(UNREACHABLE_AFTER_MS + 1_000),
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
    lastReachedAt: ago(UNREACHABLE_AFTER_MS * 10),
    reachable: true,
    now,
  });

  assert.equal(outcome.state, "HEALTHY");
  assert.equal(outcome.event?.action, "node.recovered");
});

test("a node an operator took out of service is left alone", () => {
  for (const state of ["DRAINING", "MAINTENANCE", "PENDING"] as const) {
    const silent = assessHealth({ current: state, lastReachedAt: ago(3600_000), reachable: false, now });
    const answering = assessHealth({ current: state, lastReachedAt: now, reachable: true, now });

    // Neither silence nor a successful ping overrules a decision a
    // person made — reporting maintenance as a fault teaches people to
    // ignore the ones that are real.
    assert.equal(silent.state, state);
    assert.equal(answering.state, state);
    assert.equal(silent.event, null);
  }
});

test("a node never heard from is unreachable, not healthy", () => {
  const outcome = assessHealth({ current: "HEALTHY", lastReachedAt: null, reachable: false, now });
  assert.equal(outcome.state, "UNREACHABLE");
  assert.equal(silenceLabel(outcome.silentForMs), "never heard from");
});

/* The silence that counts is the panel's, not the agent's. A node whose
   heartbeats arrive every fifteen seconds from behind a port nothing can
   call back through is not healthy — every placement, start, stop and
   file read goes the other way. Health used to decay from `lastSeenAt`,
   which those heartbeats refreshed, so such a node read as HEALTHY until
   somebody tried to put a server on it. */
test("heartbeats do not keep a node the panel cannot reach healthy", () => {
  const outcome = assessHealth({
    current: "HEALTHY",
    // Heard from a second ago; not reached for five minutes.
    lastReachedAt: ago(UNREACHABLE_AFTER_MS * 2.5),
    reachable: false,
    now,
  });

  assert.equal(outcome.state, "UNREACHABLE");
  assert.equal(outcome.event?.action, "node.unreachable");
});

test("no event when nothing changed", () => {
  const outcome = assessHealth({
    current: "UNREACHABLE",
    lastReachedAt: ago(UNREACHABLE_AFTER_MS * 2),
    reachable: false,
    now,
  });
  assert.equal(outcome.changed, false);
  assert.equal(outcome.event, null);
});

/* Retiring a node. Removing forgets the record and never touches the
   machine, so it waits until nothing on the machine would be forgotten
   with it. */

test("a node with servers on it cannot be retired, and is told what to do instead", () => {
  const retirement = retirementOf({ name: "this-pc", state: "DRAINING", servers: 1 });
  assert.match(retirement.blocker!, /still hosts 1 server\. Move it to another node, or delete it, first/);
  assert.match(retirement.blocker!, /Move it to another node/);
});

test("a node still in rotation is drained before it is retired", () => {
  for (const state of ["HEALTHY", "DEGRADED", "UNREACHABLE"]) {
    const retirement = retirementOf({ name: "this-pc", state, servers: 0 });
    assert.match(retirement.blocker!, /Drain this-pc first/, state);
  }
});

test("an empty node out of rotation can be removed — including a dead one", () => {
  assert.equal(retirementOf({ name: "a", state: "DRAINING", servers: 0 }).blocker, null);
  assert.equal(retirementOf({ name: "a", state: "MAINTENANCE", servers: 0 }).blocker, null);
});

test("servers are the first thing named, since they are the step that takes longest", () => {
  const retirement = retirementOf({ name: "a", state: "HEALTHY", servers: 3 });
  assert.match(retirement.blocker!, /3 servers\. Move them to another node, or delete them, first/);
  assert.equal(retirement.outOfRotation, false);
});
