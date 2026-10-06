// One permission check for every server operation: the page's own actions, replayed as each role, against the permission matrix.
// Run with DATABASE_URL set to the VERIFY database (load-env refuses any other).
import "./load-env.mts";
import process from "node:process";

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");
const { seed } = await import("../prisma/seed");
await seed();

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
};
const denied = (r: { ok: boolean; body: string }) => !r.ok && r.body === ops.NOT_PERMITTED;
const allowed = (r: { ok: boolean; body: string }) => r.body !== ops.NOT_PERMITTED;

const u = async (email: string) => db.user.findUniqueOrThrow({ where: { email } });
const devi = await u("devi@ashfold.gg");   // ADMIN
const tomas = await u("tomas@ashfold.gg"); // MODERATOR, owns "wipe"
const member = await db.user.upsert({
  where: { email: "ayla@ashfold.gg" },
  update: { role: "MEMBER" },
  create: { email: "ayla@ashfold.gg", name: "Ayla Verify", initials: "AV", role: "MEMBER", passwordHash: "!verify-cannot-sign-in" },
});

// A server the member owns: the only way a member comes to own one is being given it.
const given = await db.server.findFirstOrThrow({ where: { ownerId: devi.id } });
await db.server.update({ where: { id: given.id }, data: { ownerId: member.id } });
const wipe = await db.server.findUniqueOrThrow({ where: { slug: "wipe" } });
const aurora = await db.server.findUniqueOrThrow({ where: { slug: "aurora" } });

const taskOn = (serverId: string, name: string) =>
  db.scheduledTask.create({
    data: { serverId, name, kind: "COMMAND", cron: "0 4 * * *", payload: "say verify", enabled: true, nextRunAt: new Date(Date.now() + 3_600_000) },
  });
const memberTask = await taskOn(given.id, "Member task");
const wipeTask = await taskOn(wipe.id, "Wipe task");
const auroraTask = await taskOn(aurora.id, "Aurora task");

type Row = { name: string; host: string; memoryLimit: number; cpuLimit: number; restartPolicy: "ALWAYS" | "ON_FAILURE" | "NEVER"; maxRestarts: number };
const settingsOf = (s: Row) => ({
  name: s.name, host: s.host, memoryLimit: s.memoryLimit, cpuLimit: s.cpuLimit, restartPolicy: s.restartPolicy, maxRestarts: s.maxRestarts,
});

try {
  console.log("\n== a member who owns a server: what the page's own actions may do ==");
  check("start is allowed", allowed(await ops.startServerOp(member, given.slug)));
  check("stop is allowed", allowed(await ops.stopServerOp(member, given.slug)));
  check("restart is allowed", allowed(await ops.restartServerOp(member, given.slug)));
  let r = await ops.deleteServerOp(member, given.slug, given.name);
  check("delete is refused with the REST API's sentence", denied(r), JSON.stringify(r));
  check("the server is still there", (await db.server.count({ where: { id: given.id } })) === 1);
  r = await ops.updateServerSettingsOp(member, given.slug, { ...settingsOf(given), name: "Renamed by a member" });
  check("saving settings is refused", denied(r), JSON.stringify(r));
  check("and nothing was saved", (await db.server.findUniqueOrThrow({ where: { id: given.id } })).name === given.name);
  r = await ops.sendConsoleCommandOp(member, given.slug, "say from a member");
  check("a console command is refused", denied(r), JSON.stringify(r));
  r = await ops.toggleTaskOp(member, memberTask.id);
  check("pausing a task is refused", denied(r), JSON.stringify(r));
  check("and the task did not change", (await db.scheduledTask.findUniqueOrThrow({ where: { id: memberTask.id } })).enabled === true);
  r = await ops.runTaskNowOp(member, memberTask.id);
  check("running a task now is refused", denied(r), JSON.stringify(r));
  check("and it did not run", (await db.scheduledTask.findUniqueOrThrow({ where: { id: memberTask.id } })).lastRunAt === null);

  console.log("\n== a moderator who owns a server ==");
  r = await ops.deleteServerOp(tomas, wipe.slug, wipe.name);
  check("delete is refused", denied(r), JSON.stringify(r));
  check("the server is still there", (await db.server.count({ where: { id: wipe.id } })) === 1);
  check("saving settings is allowed", allowed(await ops.updateServerSettingsOp(tomas, wipe.slug, { ...settingsOf(wipe), maxRestarts: wipe.maxRestarts === 3 ? 4 : 3 })));
  check("a console command is allowed", allowed(await ops.sendConsoleCommandOp(tomas, wipe.slug, "say from a moderator")));
  check("pausing a task is allowed", allowed(await ops.toggleTaskOp(tomas, wipeTask.id)));

  console.log("\n== a moderator on a server somebody else owns ==");
  check("start", denied(await ops.startServerOp(tomas, aurora.slug)));
  check("stop", denied(await ops.stopServerOp(tomas, aurora.slug)));
  check("restart", denied(await ops.restartServerOp(tomas, aurora.slug)));
  check("settings", denied(await ops.updateServerSettingsOp(tomas, aurora.slug, { ...settingsOf(aurora), name: "Not yours" })));
  check("console", denied(await ops.sendConsoleCommandOp(tomas, aurora.slug, "say not yours")));
  check("toggle a task", denied(await ops.toggleTaskOp(tomas, auroraTask.id)));
  check("run a task", denied(await ops.runTaskNowOp(tomas, auroraTask.id)));
  check("delete", denied(await ops.deleteServerOp(tomas, aurora.slug, aurora.name)));

  console.log("\n== an admin acts on anything ==");
  check("admin may stop somebody else's server", allowed(await ops.stopServerOp(devi, aurora.slug)));
  check("admin may save its settings", allowed(await ops.updateServerSettingsOp(devi, aurora.slug, { ...settingsOf(aurora), maxRestarts: aurora.maxRestarts === 3 ? 4 : 3 })));
  check("admin may run its task", allowed(await ops.runTaskNowOp(devi, auroraTask.id)));

  console.log("\n== SEC-13: a name the DNS provider covers is dns.manage's ==");
  await db.dnsProvider.upsert({
    where: { id: "dns" },
    update: { kind: "cloudflare", zone: "covered.test" },
    create: { id: "dns", kind: "cloudflare", token: "not-a-real-token", zone: "covered.test" },
  });
  const wipeNow = async () => db.server.findUniqueOrThrow({ where: { id: wipe.id } });
  r = await ops.updateServerSettingsOp(tomas, wipe.slug, { ...settingsOf(await wipeNow()), host: "wipe.covered.test" });
  check("a moderator cannot point a server at a managed name", !r.ok && r.body.includes("DNS zone"), JSON.stringify(r));
  check("the address did not change", (await wipeNow()).host === wipe.host);
  r = await ops.updateServerSettingsOp(tomas, wipe.slug, { ...settingsOf(await wipeNow()), host: "wipe.elsewhere.example" });
  check("an address outside the zone is still the moderator's to set", r.ok, JSON.stringify(r));
  r = await ops.updateServerSettingsOp(devi, wipe.slug, { ...settingsOf(await wipeNow()), host: "wipe.covered.test" });
  check("an admin may point a server at a managed name", r.ok || !r.body.includes("only an owner or an admin"), JSON.stringify(r));

  console.log("\n== the sentence is the API's ==");
  check("NOT_PERMITTED is what REST says", ops.NOT_PERMITTED === "You do not have permission to do that.");
} finally {
  await db.dnsProvider.deleteMany({ where: { id: "dns" } });
  await db.scheduledTask.deleteMany({ where: { id: { in: [memberTask.id, wipeTask.id, auroraTask.id] } } });
  await db.server.update({ where: { id: given.id }, data: { ownerId: devi.id } });
}

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
