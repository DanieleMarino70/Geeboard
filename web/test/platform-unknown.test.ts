import assert from "node:assert/strict";
import { test } from "node:test";
import { games } from "../src/lib/catalog.ts";
import { checkCompatibility, type NodeProfile } from "../src/domain/nodes/compatibility.ts";

/* A node that reports an architecture or an operating system the panel has no word for (a 32-bit Raspberry Pi says armv7l, other machines
   riscv64, s390x or freebsd) is refused by name, in the engine's own sentence, where it was "has not reported one yet" and allowed: the
   create then failed at the image pull with a manifest error. These go through the engine with the value as the node said it. */

const node = (over: Partial<NodeProfile>): NodeProfile => ({
  name: "pi",
  region: "eu",
  state: "HEALTHY",
  pingMs: 10,
  os: "linux",
  arch: "x64",
  capabilities: ["docker", "java", "steamcmd"],
  cpuTotalPct: 400,
  ramTotalGb: 16,
  diskTotalGb: 500,
  cpuCommittedPct: 0,
  ramCommittedGb: 0,
  diskCommittedGb: 0,
  servers: 0,
  hosted: [],
  hasAgent: true,
  agentVersionMismatch: null,
  ...over,
});

const terraria = games().find((g) => g.id === "terraria")!;
const request = { memoryGb: terraria.defaults.memoryGb, cpuLimit: terraria.defaults.cpuLimit, diskGb: terraria.defaults.diskGb };

test("armv7l is refused by name, not read as 'has not reported one yet'", () => {
  const verdict = checkCompatibility(terraria, node({ arch: "armv7l" }), request);
  const arch = verdict.reasons.find((r) => r.label === "Architecture");
  assert.equal(arch?.ok, false);
  assert.match(arch?.detail ?? "", /needs x64.*not armv7l/);
  assert.equal(verdict.verdict, "incompatible");
});

test("freebsd and riscv64 are the same", () => {
  assert.equal(checkCompatibility(terraria, node({ os: "freebsd" }), request).verdict, "incompatible");
  assert.equal(checkCompatibility(terraria, node({ arch: "riscv64" }), request).verdict, "incompatible");
});

test("a node that has said nothing is still unknown, not wrong", () => {
  const verdict = checkCompatibility(terraria, node({ os: null, arch: null }), request);
  assert.equal(verdict.reasons.find((r) => r.label === "Architecture")?.ok, null);
  assert.equal(verdict.reasons.find((r) => r.label === "Operating system")?.ok, null);
});

/* Consent to run somebody else's image is a yes the machine's operator gave, and not the absence of a no: a node that reported nothing at all has not given
   it (the audit of 0.9.5 created a community container on one), while a game that needs no consent is still only unsure about such a node. */

test("a community game is refused by a node that has reported no capabilities, and is allowed by one that consented", () => {
  const community = { ...terraria, requirements: { ...terraria.requirements, capabilities: ["community-games" as const] } };
  const silent = checkCompatibility(community, node({ capabilities: [] }), request);
  const refused = silent.reasons.find((r) => r.kind === "capability");
  assert.equal(refused?.ok, false, "no list is not a yes");
  assert.match(refused?.detail ?? "", /Community games/);
  assert.equal(checkCompatibility(community, node({ capabilities: ["docker"] }), request).reasons.find((r) => r.kind === "capability")?.ok, false);
  assert.equal(checkCompatibility(community, node({ capabilities: ["docker", "community-games"] }), request).reasons.find((r) => r.kind === "capability")?.ok, true);
  // A game that asks for nothing special is still only unsure about a node that said nothing.
  assert.equal(checkCompatibility(terraria, node({ capabilities: [] }), request).reasons.find((r) => r.kind === "capability")?.ok ?? null, null);
});
