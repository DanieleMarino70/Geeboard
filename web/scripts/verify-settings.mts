import "./load-env.mts";
import process from "node:process";

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");
const { validateSettings } = await import("../src/lib/settings-rules");

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
const aurora = (await db.server.findUnique({ where: { slug: "aurora" } }))!;

const base = {
  name: aurora.name, host: aurora.host, memoryLimit: aurora.memoryLimit,
  cpuLimit: aurora.cpuLimit, restartPolicy: aurora.restartPolicy, maxRestarts: aurora.maxRestarts,
};
const invalid = (input: typeof base) => Object.keys(validateSettings(input)).length > 0;

console.log("\n== validation ==");
check("blank name rejected", invalid({ ...base, name: "" }));
check("bad hostname rejected", invalid({ ...base, host: "not a host" }));
check("memory over 64 GB rejected", invalid({ ...base, memoryLimit: 128 }));
check("cpu under 50% rejected", invalid({ ...base, cpuLimit: 10 }));
check("valid input accepted", !invalid(base));

/* Checked against the game and the node, not a fixed 1–64 GB: a Minecraft
   server is allowed up to 32 GB, and no more than its node has left. */
const limits = await ops.settingsLimitsFor(aurora);
check("the game's own ceiling applies", limits.memoryGb[1] === 32, JSON.stringify(limits));
let r0 = await ops.updateServerSettingsOp(mara, "aurora", { ...base, memoryLimit: 40 });
check("more memory than the game allows is refused", !r0.ok && Boolean((r0 as { errors?: Record<string, string> }).errors?.memoryLimit), JSON.stringify(r0));
r0 = await ops.updateServerSettingsOp(mara, "aurora", { ...base, memoryLimit: Math.min(32, (limits.memoryAvailableGb ?? 0) + 1) });
check(
  "more memory than the node has left is refused",
  (limits.memoryAvailableGb ?? 99) >= 32 || (!r0.ok && /left for this server/.test(r0.body)),
  JSON.stringify(r0),
);

console.log("\n== no-op save ==");
/* Read the row back first: the capacity check above is allowed to
   succeed on a node with room to spare, and comparing against the
   values this script started with would then be comparing against
   something that is no longer stored. */
const current = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
const saved = {
  name: current.name, host: current.host, memoryLimit: current.memoryLimit,
  cpuLimit: current.cpuLimit, restartPolicy: current.restartPolicy, maxRestarts: current.maxRestarts,
};
let r = await ops.updateServerSettingsOp(mara, "aurora", saved);
check("unchanged form is refused", !r.ok && r.title === "Nothing to save", JSON.stringify(r));

console.log("\n== authorization ==");
r = await ops.updateServerSettingsOp(tomas, "aurora", { ...base, memoryLimit: 12 });
check("moderator blocked on another owner's server", !r.ok && r.body.includes("permission"));

console.log("\n== address collision ==");
r = await ops.updateServerSettingsOp(mara, "aurora", { ...base, host: "build.ashfold.gg" });
check("duplicate address refused", !r.ok && r.title === "Address in use", JSON.stringify(r));

console.log("\n== a real change ==");
const wanted = { memory: saved.memoryLimit === 6 ? 5 : 6, restarts: saved.maxRestarts === 5 ? 4 : 5 };
r = await ops.updateServerSettingsOp(mara, "aurora", {
  ...saved, memoryLimit: wanted.memory, maxRestarts: wanted.restarts, name: "Aurora SMP Two",
});
check("save succeeds", r.ok, JSON.stringify(r));
/* The sample server is simulated, so there is no workload to rebuild; on
   a real node a new memory limit says it takes a rebuild. */
check("a simulated server is not told to rebuild", r.ok && (r as { rebuildRequired?: boolean }).rebuildRequired === false);

const after = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
check("memory persisted", after.memoryLimit === wanted.memory, String(after.memoryLimit));
check("name persisted", after.name === "Aurora SMP Two", after.name);

const ev = (await db.activityEvent.findFirst({
  where: { action: "server.settings.updated" }, orderBy: { createdAt: "desc" },
}))!;
const ch = ev.changes as Record<string, { from: unknown; to: unknown }>;
check("audit event written", !!ev);
check("records exactly the 3 changed fields", Object.keys(ch).length === 3, Object.keys(ch).join(","));
check("memory from/to recorded",
      ch["Memory limit"]?.from === saved.memoryLimit && ch["Memory limit"]?.to === wanted.memory,
      JSON.stringify(ch["Memory limit"]));

console.log("\n== delete guard ==");
r = await ops.deleteServerOp(mara, "wipe", "wrong name");
check("wrong confirmation refused", !r.ok && r.title === "Name does not match");
check("server still exists", (await db.server.findUnique({ where: { slug: "wipe" } })) !== null);
r = await ops.deleteServerOp(mara, "wipe", "Wipe Wednesday");
check("exact name deletes", r.ok, JSON.stringify(r));
check("server is gone", (await db.server.findUnique({ where: { slug: "wipe" } })) === null);
check("deletion is audited",
  (await db.activityEvent.count({ where: { action: "server.deleted" } })) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
