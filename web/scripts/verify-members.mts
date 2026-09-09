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

const u = async (email: string) => (await db.user.findUnique({ where: { email } }))!;
let mara = await u("mara@ashfold.gg");   // OWNER
let devi = await u("devi@ashfold.gg");   // ADMIN
const tomas = await u("tomas@ashfold.gg"); // MODERATOR

console.log("\n== who may change roles ==");
let r = await ops.changeMemberRoleOp(tomas, devi.id, "MEMBER");
check("moderator cannot change roles", !r.ok && r.title === "Not permitted", JSON.stringify(r));
r = await ops.changeMemberRoleOp(mara, mara.id, "ADMIN");
check("owner cannot change own role", !r.ok && r.title.includes("own role"));
r = await ops.changeMemberRoleOp(mara, devi.id, "ADMIN");
check("no-op role change refused", !r.ok && r.title === "No change");

console.log("\n== admins cannot mint or strip owners ==");
r = await ops.changeMemberRoleOp(devi, tomas.id, "OWNER");
check("admin cannot grant OWNER", !r.ok && r.body.includes("Only an owner"), JSON.stringify(r));
r = await ops.changeMemberRoleOp(devi, mara.id, "MEMBER");
check("admin cannot demote an owner", !r.ok && r.body.includes("Only an owner"));

console.log("\n== last-owner protection ==");
r = await ops.changeMemberRoleOp(mara, mara.id, "MEMBER");
check("owner cannot self-demote", !r.ok);
// Promote Devi so there are two owners, then demotion becomes allowed.
r = await ops.changeMemberRoleOp(mara, devi.id, "OWNER");
check("owner can promote to OWNER", r.ok, JSON.stringify(r));
devi = await u("devi@ashfold.gg");
check("promotion persisted", devi.role === "OWNER", devi.role);
r = await ops.changeMemberRoleOp(devi, mara.id, "ADMIN");
check("second owner can demote the first", r.ok, JSON.stringify(r));
mara = await u("mara@ashfold.gg");
check("demotion persisted", mara.role === "ADMIN", mara.role);
r = await ops.changeMemberRoleOp(devi, devi.id, "ADMIN");
check("last owner cannot self-demote either", !r.ok);

console.log("\n== role change is audited with a diff ==");
const ev = (await db.activityEvent.findFirst({
  where: { action: "member.role.changed" }, orderBy: { createdAt: "desc" },
}))!;
const ch = ev.changes as Record<string, { from: string; to: string }>;
check("event written", !!ev);
check("records from → to", ch?.Role?.from === "OWNER" && ch?.Role?.to === "ADMIN", JSON.stringify(ch));

console.log("\n== removing members ==");
r = await ops.removeMemberOp(tomas, mara.id);
check("moderator cannot remove", !r.ok && r.title === "Not permitted");
r = await ops.removeMemberOp(devi, devi.id);
check("cannot remove yourself", !r.ok && r.title.includes("yourself"));
r = await ops.removeMemberOp(devi, tomas.id);
check("member owning servers is protected", !r.ok && r.title === "Servers still owned", JSON.stringify(r));

// Give Tomas's server away, then removal should work.
await db.server.updateMany({ where: { ownerId: tomas.id }, data: { ownerId: devi.id } });
r = await ops.removeMemberOp(devi, tomas.id);
check("removal succeeds once servers are transferred", r.ok, JSON.stringify(r));
check("account is gone", (await db.user.findUnique({ where: { id: tomas.id } })) === null);
check("removal is audited",
  (await db.activityEvent.count({ where: { action: "member.removed" } })) === 1);

console.log("\n== node drain ==");
const moderatorless = await u("mara@ashfold.gg"); // now ADMIN
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", true);
check("admin can drain", r.ok, JSON.stringify(r));
check("node state persisted",
  (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.state === "DRAINING");
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", true);
check("draining twice refused", !r.ok && r.title === "Already draining");
r = await ops.setNodeDrainOp(moderatorless, "fra-node-02", false);
check("resume works", r.ok);
check("back to healthy",
  (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.state === "HEALTHY");
r = await ops.setNodeDrainOp(moderatorless, "does-not-exist", true);
check("unknown node refused", !r.ok);

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
