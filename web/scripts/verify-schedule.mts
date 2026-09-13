import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");

// Start from the known fixture so these run in any order, repeatedly.
const { seed } = await import("../prisma/seed");
await seed();

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
};

const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
const tomas = (await db.user.findUnique({ where: { email: "tomas@ashfold.gg" } }))!;

console.log("\n== backup lock / delete ==");
const locked = (await db.backup.findFirst({ where: { state: "LOCKED" } }))!;
let r = await ops.deleteBackupOp(mara, locked.id);
check("locked backup refuses deletion", !r.ok && r.title === "Backup is locked", JSON.stringify(r));

r = await ops.setBackupLockOp(mara, locked.id, false);
check("unlock succeeds", r.ok);
r = await ops.deleteBackupOp(mara, locked.id);
check("unlocked backup deletes", r.ok);
check("row is gone", (await db.backup.findUnique({ where: { id: locked.id } })) === null);

console.log("\n== backup authorization ==");
const auroraBackup = (await db.backup.findFirst({ where: { server: { slug: "aurora" } } }))!;
r = await ops.deleteBackupOp(tomas, auroraBackup.id);
check("moderator blocked on another owner's backup", !r.ok && r.body.includes("cannot"), JSON.stringify(r));

/* The bug this assertion exists for: a node that cannot be reached lets
   an operator tidy up a record whose bytes are gone, and for a while
   that branch also swallowed "you are not allowed" — so a refusal
   deleted the row, which is most of what deleting a backup means. */
check(
  "and the row survives the refusal",
  (await db.backup.findUnique({ where: { id: auroraBackup.id } })) !== null,
);

/* The seeded workspace has no agents, which is the point of these
   three: since backups became archives rather than records, every one
   of these operations has to refuse rather than pretend. A success here
   would mean the panel was inventing bytes again. */
console.log("\n== without an agent, nothing is pretended ==");
await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING", playersOn: 23 } });

r = await ops.restoreBackupOp(mara, auroraBackup.id);
check("restore refuses with no agent", !r.ok, JSON.stringify(r));
const afterRestore = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
check("and the server was not touched", afterRestore.state === "RUNNING", afterRestore.state);

r = await ops.createBackupOp(mara, "aurora");
check("a backup refuses rather than fabricating one", !r.ok, JSON.stringify(r));

console.log("\n== task toggle ==");
const task = (await db.scheduledTask.findFirst({ where: { name: "Nightly snapshot" } }))!;
check("starts enabled with a next run", task.enabled && task.nextRunAt !== null);
r = await ops.toggleTaskOp(mara, task.id);
let t2 = (await db.scheduledTask.findUnique({ where: { id: task.id } }))!;
check("pausing clears nextRunAt", r.ok && !t2.enabled && t2.nextRunAt === null);
r = await ops.toggleTaskOp(mara, task.id);
t2 = (await db.scheduledTask.findUnique({ where: { id: task.id } }))!;
check("re-enabling recomputes nextRunAt", r.ok && t2.enabled && t2.nextRunAt !== null,
      String(t2.nextRunAt));

console.log("\n== run task now ==");
const backupsBefore = await db.backup.count({ where: { server: { slug: "aurora" } } });
r = await ops.runTask(mara, task.id);
const backupsAfter = await db.backup.count({ where: { server: { slug: "aurora" } } });

/* Two different failures, and they leave different traces. A node with
   no agent is refused before a row is written — a FAILED backup saying
   "there was nowhere to put it" is noise, not a record of an attempt.
   An archive that starts and then fails does leave its row marked
   FAILED, because there the operator needs to know it began. */
check("a BACKUP task that cannot run is not a success", !r.ok, JSON.stringify(r));
check("and writes no row at all", backupsAfter === backupsBefore,
      `${backupsBefore} → ${backupsAfter}`);

t2 = (await db.scheduledTask.findUnique({ where: { id: task.id } }))!;
check("the run is recorded on the task", t2.lastRunAt !== null && t2.lastResult === "FAILED",
      String(t2.lastResult));
check("and the next run is recomputed", t2.nextRunAt !== null, String(t2.nextRunAt));

const broadcast = (await db.scheduledTask.findFirst({ where: { kind: "BROADCAST" } }))!;
r = await ops.runTask(mara, broadcast.id);
check("a BROADCAST with no console refuses", !r.ok, JSON.stringify(r));

console.log("\n== cleanup keeps the newest, and never a locked one ==");
const wipe = (await db.server.findUnique({ where: { slug: "wipe" } }))!;
await db.backup.deleteMany({ where: { serverId: wipe.id } });
for (let i = 0; i < 5; i++) {
  await db.backup.create({
    data: {
      serverId: wipe.id,
      name: `old-${i}`,
      sizeBytes: BigInt(1),
      state: i === 0 ? "LOCKED" : "COMPLETE",
      createdAt: new Date(Date.now() - i * 3600_000),
    },
  });
}
const removed = await ops.pruneBackups(wipe.id, 2);
const left = await db.backup.findMany({ where: { serverId: wipe.id }, orderBy: { name: "asc" } });
check("older backups are pruned", removed === 2, `removed ${removed}`);
check("the locked one survives", left.some((b) => b.state === "LOCKED"), left.map((b) => b.name).join(", "));
check("and the newest are kept", left.length === 3, String(left.length));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
