import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");

// Start from the known fixture so these run in any order, repeatedly.
const { seed } = await import("../prisma/seed");
await seed();

const show = async (slug: string) => {
  const s = await db.server.findUnique({ where: { slug }, select: { state: true, playersOn: true } });
  return `${s!.state}/${s!.playersOn}p`;
};
const line = (label: string, r: { ok: boolean; title: string }) =>
  console.log(`  ${r.ok ? "OK  " : "DENY"} ${label.padEnd(28)} → ${r.title}`);

const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;   // OWNER
const tomas = (await db.user.findUnique({ where: { email: "tomas@ashfold.gg" } }))!; // MODERATOR

console.log("\n== authorization ==");
line("tomas stops aurora (not his)", await ops.stopServerOp(tomas, "aurora"));
line("tomas stops wipe (he owns it)", await ops.stopServerOp(tomas, "wipe"));
line("mara acts on unknown slug", await ops.startServerOp(mara, "does-not-exist"));

console.log("\n== lifecycle on 'wipe' ==");
console.log("  state before:", await show("wipe"));
line("start", await ops.startServerOp(mara, "wipe"));
console.log("  state after start:", await show("wipe"));
line("start again (guard)", await ops.startServerOp(mara, "wipe"));
line("stop", await ops.stopServerOp(mara, "wipe"));
console.log("  state after stop:", await show("wipe"));
line("stop again (guard)", await ops.stopServerOp(mara, "wipe"));

console.log("\n== restart clears players ==");
console.log("  aurora before:", await show("aurora"));
line("restart aurora", await ops.restartServerOp(mara, "aurora"));
console.log("  aurora after:", await show("aurora"));

console.log("\n== backup ==");
const before = await db.backup.count({ where: { server: { slug: "aurora" } } });
const r = await ops.createBackupOp(mara, "aurora");
line("create backup", r);
console.log("  body:", (r as { body: string }).body);
console.log(`  backup rows: ${before} → ${await db.backup.count({ where: { server: { slug: "aurora" } } })}`);

console.log("\n== activity events written ==");
for (const e of await db.activityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 5 })) {
  console.log(`  ${e.actor} ${e.action} · ${e.target} [${e.tone}]`);
}
await db.$disconnect();
