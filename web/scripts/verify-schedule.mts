import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");

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
check("locked snapshot refuses deletion", !r.ok && r.title === "Snapshot is locked", JSON.stringify(r));

r = await ops.setBackupLockOp(mara, locked.id, false);
check("unlock succeeds", r.ok);
r = await ops.deleteBackupOp(mara, locked.id);
check("unlocked snapshot deletes", r.ok);
check("row is gone", (await db.backup.findUnique({ where: { id: locked.id } })) === null);

console.log("\n== backup authorization ==");
const auroraBackup = (await db.backup.findFirst({ where: { server: { slug: "aurora" } } }))!;
r = await ops.deleteBackupOp(tomas, auroraBackup.id);
check("moderator blocked on another owner's snapshot", !r.ok && r.body.includes("permission"), JSON.stringify(r));

console.log("\n== restore stops the server ==");
await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING", playersOn: 23 } });
r = await ops.restoreBackupOp(mara, auroraBackup.id);
const afterRestore = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
check("restore reports back", r.ok, JSON.stringify(r));
check("server moved to STOPPING", afterRestore.state === "STOPPING", afterRestore.state);
check("players cleared", afterRestore.playersOn === 0, String(afterRestore.playersOn));

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
r = await ops.runTaskNowOp(mara, task.id);
const backupsAfter = await db.backup.count({ where: { server: { slug: "aurora" } } });
check("BACKUP task actually creates a snapshot", r.ok && backupsAfter === backupsBefore + 1,
      `${backupsBefore} → ${backupsAfter}`);
t2 = (await db.scheduledTask.findUnique({ where: { id: task.id } }))!;
check("run is recorded on the task", t2.lastRunAt !== null && t2.lastResult === "SUCCEEDED");

const broadcast = (await db.scheduledTask.findFirst({ where: { kind: "BROADCAST" } }))!;
r = await ops.runTaskNowOp(mara, broadcast.id);
check("BROADCAST task records a run", r.ok, JSON.stringify(r));

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
