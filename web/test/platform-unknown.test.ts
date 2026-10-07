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
