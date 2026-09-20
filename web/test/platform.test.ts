import assert from "node:assert/strict";
import { test } from "node:test";
import { can, grantedTo, permissionsForScopes, scopeOf } from "../src/domain/access/permissions.ts";
import { PlatformError, asPlatformError } from "../src/domain/errors.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { blockers, cannotRun, checkCompatibility, type NodeProfile } from "../src/domain/nodes/compatibility.ts";
import { canStart, canStop, endsThePass, mapRuntimeState, reconcile, workloadMissing } from "../src/domain/servers/state.ts";

/* ── Server state ─────────────────────────────────────────────────── */

test("the runtime's vocabulary maps onto server states", () => {
  assert.equal(mapRuntimeState("running"), "RUNNING");
  assert.equal(mapRuntimeState("crashed"), "CRASHED");
  // "unknown" must not read as down — that would show a running server
  // as stopped every time a status call came back confused.
  assert.equal(mapRuntimeState("unknown"), "STOPPED");
});

test("a state the panel owns is not overwritten by what the node sees", () => {
  // Mid-install there is no workload yet, so the node says stopped.
  const outcome = reconcile("INSTALLING", "STOPPED");
  assert.equal(outcome.state, "INSTALLING");
  assert.equal(outcome.held, true);
  assert.equal(outcome.event, null);
});

test("a suspended server stays suspended however its workload looks", () => {
  assert.equal(reconcile("SUSPENDED", "STOPPED").state, "SUSPENDED");
  assert.equal(reconcile("SUSPENDED", "RUNNING").state, "SUSPENDED");
});

test("a crash nobody asked for is drift worth reporting", () => {
  const outcome = reconcile("RUNNING", "CRASHED");
  assert.equal(outcome.state, "CRASHED");
  assert.equal(outcome.event?.action, "server.crashed");
  assert.equal(outcome.event?.tone, "DANGER");
});

/* Found on a real node: recovery gave up and wrote ERROR, the next poll
   read the dead container back as CRASHED, recovery gave up again, and
   the activity log took two events every fifteen seconds. */
test("a server the panel gave up on stays given up while it is still down", () => {
  for (const observed of ["CRASHED", "STOPPED"] as const) {
    const outcome = reconcile("ERROR", observed);
    assert.equal(outcome.state, "ERROR");
    assert.equal(outcome.held, true, "held, so recovery is not run on it again");
    assert.equal(outcome.event, null);
  }
  // Coming back up is still news, and still clears it.
  assert.equal(reconcile("ERROR", "RUNNING").state, "RUNNING");
  assert.equal(reconcile("ERROR", "RUNNING").event?.action, "server.recovered");
});

/* A node that answers and says the workload does not exist. Found on
   this PC after a Docker reset: the poller logged "no such container" on
   every pass, and nothing on the page could bring the server back. */
test("a workload removed outside the panel is an error, said once", () => {
  for (const current of ["RUNNING", "STOPPED", "CRASHED", "UNHEALTHY", "ERROR"] as const) {
    const outcome = workloadMissing(current);
    assert.equal(outcome.state, "ERROR", current);
    assert.equal(outcome.event?.action, "server.workload.missing");
    assert.equal(outcome.event?.tone, "DANGER");
  }
});

test("mid-operation, a missing workload is expected and held", () => {
  // An update destroys the old workload before it makes the new one.
  for (const current of ["UPDATING", "INSTALLING", "CREATING", "DELETING"] as const) {
    const outcome = workloadMissing(current);
    assert.equal(outcome.held, true, current);
    assert.equal(outcome.state, current);
    assert.equal(outcome.event, null);
  }
});

test("a server going down while the panel thought it was up is a warning", () => {
  assert.equal(reconcile("RUNNING", "STOPPED").event?.action, "server.stopped.unexpectedly");
  assert.equal(reconcile("UNHEALTHY", "STOPPED").event?.action, "server.stopped.unexpectedly");
});

test("a transition the panel asked for is not news", () => {
  assert.equal(reconcile("STARTING", "RUNNING").event, null);
  assert.equal(reconcile("STOPPING", "STOPPED").event, null);
  assert.equal(reconcile("RUNNING", "RUNNING").event, null);
});

test("coming back on its own is worth a note", () => {
  assert.equal(reconcile("CRASHED", "RUNNING").event?.action, "server.recovered");
  assert.equal(reconcile("STOPPED", "RUNNING").event?.action, "server.recovered");
});

test("a running workload does not clear an unhealthy game", () => {
  const outcome = reconcile("UNHEALTHY", "RUNNING");
  assert.equal(outcome.state, "UNHEALTHY");
  assert.equal(outcome.held, true);
});

test("an unhealthy server is held, and still gets the health check that can clear it", () => {
  // Skipped with the other held states, it stayed UNHEALTHY for good.
  assert.equal(endsThePass(reconcile("UNHEALTHY", "RUNNING")), false);
  assert.equal(endsThePass(reconcile("UPDATING", "STOPPED")), true);
  assert.equal(endsThePass(reconcile("MIGRATING", "RUNNING")), true);
  assert.equal(endsThePass(reconcile("RUNNING", "RUNNING")), false);
});

test("lifecycle guards read from the state, not from the caller", () => {
  assert.equal(canStart("STOPPED"), true);
  assert.equal(canStart("CRASHED"), true);
  assert.equal(canStart("RUNNING"), false);
  assert.equal(canStop("RUNNING"), true);
  assert.equal(canStop("UNHEALTHY"), true);
  assert.equal(canStop("STOPPED"), false);
});

/* ── Compatibility ────────────────────────────────────────────────── */

const NODE: NodeProfile = {
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
  cpuCommittedPct: 400,
  ramCommittedGb: 16,
  diskCommittedGb: 200,
  servers: 3,
  hasAgent: true,
};

const REQUEST = { memoryGb: 8, cpuLimit: 300, diskGb: 30 };

test("a node with room and the right capabilities is compatible", () => {
  const report = checkCompatibility(requireGame("project-zomboid"), NODE, REQUEST);
  assert.equal(report.verdict, "compatible");
  assert.deepEqual(blockers(report), []);
});

/* Valheim, whose image runs SteamCMD itself on first boot. Zomboid used to
   be the example; its image now carries the game, so a node needs Docker
   and nothing else. */
test("a missing capability is incompatible, and says which one", () => {
  const node = { ...NODE, capabilities: ["docker"] as NodeProfile["capabilities"] };
  const report = checkCompatibility(requireGame("valheim"), node, { ...REQUEST, memoryGb: 4, cpuLimit: 200 });
  assert.equal(report.verdict, "incompatible");
  assert.match(blockers(report)[0]!.detail!, /SteamCMD/);
});

test("more memory than the node has uncommitted is incompatible, with the numbers", () => {
  const node = { ...NODE, ramCommittedGb: 60 };
  const report = checkCompatibility(requireGame("project-zomboid"), node, REQUEST);
  assert.equal(report.verdict, "incompatible");
  assert.match(blockers(report).find((b) => b.label === "Memory")!.detail!, /8 GB requested, 4 GB/);
});

test("a node that has not reported its platform is partial, not refused", () => {
  const node = { ...NODE, os: null, arch: null };
  const report = checkCompatibility(requireGame("terraria"), node, REQUEST);
  assert.equal(report.verdict, "partial");
  assert.deepEqual(blockers(report), []);
});

test("a draining node is refused however much room it has", () => {
  const report = checkCompatibility(requireGame("terraria"), { ...NODE, state: "DRAINING" }, REQUEST);
  assert.equal(report.verdict, "incompatible");
  assert.match(blockers(report)[0]!.label, /Accepting servers/);
});

test("asking for less than the game's own floor is refused", () => {
  const report = checkCompatibility(requireGame("project-zomboid"), NODE, {
    ...REQUEST,
    memoryGb: 2,
  });
  assert.equal(report.verdict, "incompatible");
  assert.ok(blockers(report).some((b) => b.label === "Meets the game's minimum"));
});

/* What creation refuses on by itself. Resources and availability have
   their own refusals with the numbers in them; this is only whether the
   game can run on that machine at all. */
test("cannotRun names a missing capability", () => {
  const node = { ...NODE, capabilities: ["docker"] as NodeProfile["capabilities"] };
  const reasons = cannotRun(checkCompatibility(requireGame("valheim"), node, { ...REQUEST, memoryGb: 4, cpuLimit: 200 }));
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /^Missing SteamCMD/);
});

test("cannotRun names the wrong operating system and architecture", () => {
  const node = { ...NODE, os: "windows" as const, arch: "arm64" as const };
  const reasons = cannotRun(checkCompatibility(requireGame("terraria"), node, REQUEST));
  assert.ok(reasons.some((r) => /needs linux, not windows/.test(r)));
  assert.ok(reasons.some((r) => /needs x64, not arm64/.test(r)));
});

test("cannotRun does not refuse on what a node has not reported", () => {
  const node = { ...NODE, os: null, arch: null, capabilities: [] };
  assert.deepEqual(cannotRun(checkCompatibility(requireGame("project-zomboid"), node, REQUEST)), []);
});

test("cannotRun leaves capacity and availability to their own refusals", () => {
  const node = { ...NODE, ramCommittedGb: 64, state: "DRAINING" as const };
  const report = checkCompatibility(requireGame("project-zomboid"), node, REQUEST);
  assert.equal(report.verdict, "incompatible");
  assert.deepEqual(cannotRun(report), []);
});

test("an unattached node is a warning rather than a refusal", () => {
  const report = checkCompatibility(requireGame("terraria"), { ...NODE, hasAgent: false }, REQUEST);
  assert.equal(report.verdict, "partial");
});

test("headroom is what would be left, so a fuller node ranks lower", () => {
  const roomy = checkCompatibility(requireGame("terraria"), NODE, REQUEST);
  const busy = checkCompatibility(
    requireGame("terraria"),
    { ...NODE, ramCommittedGb: 48 },
    REQUEST,
  );
  assert.ok(roomy.headroom.ram > busy.headroom.ram);
});

/* ── Permissions ──────────────────────────────────────────────────── */

const owner = { id: "u-owner", role: "OWNER" as const };
const admin = { id: "u-admin", role: "ADMIN" as const };
const mod = { id: "u-mod", role: "MODERATOR" as const };
const member = { id: "u-member", role: "MEMBER" as const };

test("owners and admins reach any server", () => {
  assert.equal(can(owner, "server.delete", "someone-else"), true);
  assert.equal(can(admin, "server.files.write", "someone-else"), true);
});

test("a member only reaches their own servers", () => {
  assert.equal(can(member, "server.start", member.id), true);
  assert.equal(can(member, "server.start", "someone-else"), false);
});

test("only owners and admins create or delete servers", () => {
  assert.equal(can(mod, "server.create"), false);
  assert.equal(can(member, "server.create"), false);
  assert.equal(can(member, "server.delete", member.id), false);
  assert.equal(can(owner, "server.create"), true);
});

test("a moderator watches any console but types only into their own", () => {
  assert.equal(can(mod, "server.console.read", "someone-else"), true);
  assert.equal(can(mod, "server.console.write", "someone-else"), false);
  assert.equal(can(mod, "server.console.write", mod.id), true);
});

test("console access does not carry the filesystem with it", () => {
  assert.equal(can(mod, "server.files.read", "someone-else"), false);
  assert.equal(can(mod, "server.files.write", "someone-else"), false);
});

test("an owner-scoped permission needs an owner to compare against", () => {
  assert.equal(scopeOf("MEMBER", "server.start"), "own");
  // No resource named, so "own" cannot be satisfied.
  assert.equal(can(member, "server.start"), false);
  assert.equal(can(member, "server.start", null), false);
});

test("managing nodes is not something a member can do", () => {
  assert.equal(can(member, "node.read"), true);
  assert.equal(can(member, "node.manage"), false);
  assert.equal(can(mod, "node.manage"), false);
});

test("every role has at least a read of the panel", () => {
  for (const role of ["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const) {
    assert.ok(grantedTo(role).length > 0, role);
  }
});

test("API key scopes narrow a user, they never widen one", () => {
  const allowed = permissionsForScopes(["servers:read", "console:write"]);
  assert.ok(allowed.has("server.read"));
  assert.ok(allowed.has("server.console.write"));
  // The scope list has nothing that could grant deletion.
  assert.equal(allowed.has("server.delete"), false);
  assert.equal(permissionsForScopes(["not-a-scope"]).size, 0);
});

/* ── Errors ───────────────────────────────────────────────────────── */

test("a platform error carries a code, a status and a safe body", () => {
  const error = new PlatformError("CAPACITY_EXHAUSTED", "The node is full.", {
    details: { node: "mil-node-01" },
    cause: new Error("connection string: postgres://secret@host"),
  });
  assert.equal(error.status, 409);
  assert.deepEqual(error.toBody(), {
    code: "CAPACITY_EXHAUSTED",
    message: "The node is full.",
    details: { node: "mil-node-01" },
  });
  // The cause is for the log; it must not be in what a client sees.
  assert.equal(JSON.stringify(error.toBody()).includes("secret"), false);
});

test("an unexpected throw becomes a generic internal error", () => {
  const error = asPlatformError(new Error("ECONNREFUSED 10.24.8.2:5432"));
  assert.equal(error.code, "INTERNAL");
  assert.equal(error.status, 500);
  assert.equal(error.message.includes("10.24.8.2"), false);
  assert.equal(error.cause instanceof Error, true);
});
