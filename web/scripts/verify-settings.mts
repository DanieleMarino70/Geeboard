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
const aurora = (await db.server.findUnique({ where: { slug: "aurora" } }))!;

const base = {
  name: aurora.name, host: aurora.host, motd: aurora.motd ?? "",
  javaFlags: aurora.javaFlags ?? "", memoryLimit: aurora.memoryLimit,
  cpuLimit: aurora.cpuLimit, autosave: aurora.autosave,
  whitelist: aurora.whitelist, autoRestart: aurora.autoRestart,
};

console.log("\n== validation ==");
check("blank name rejected", ops.validateSettings({ ...base, name: "" }) !== null);
check("bad hostname rejected", ops.validateSettings({ ...base, host: "not a host" }) !== null);
check("memory over 64 GB rejected", ops.validateSettings({ ...base, memoryLimit: 128 }) !== null);
check("cpu under 50% rejected", ops.validateSettings({ ...base, cpuLimit: 10 }) !== null);
check("valid input accepted", ops.validateSettings(base) === null);

console.log("\n== no-op save ==");
let r = await ops.updateServerSettingsOp(mara, "aurora", base);
check("unchanged form is refused", !r.ok && r.title === "Nothing to save", JSON.stringify(r));

console.log("\n== authorization ==");
r = await ops.updateServerSettingsOp(tomas, "aurora", { ...base, memoryLimit: 12 });
check("moderator blocked on another owner's server", !r.ok && r.body.includes("permission"));

console.log("\n== host collision ==");
r = await ops.updateServerSettingsOp(mara, "aurora", { ...base, host: "build.ashfold.gg" });
check("duplicate subdomain refused", !r.ok && r.title === "Subdomain in use", JSON.stringify(r));

console.log("\n== a real change ==");
r = await ops.updateServerSettingsOp(mara, "aurora", {
  ...base, memoryLimit: 12, motd: "Season five starts Friday", whitelist: !base.whitelist,
});
check("save succeeds", r.ok, JSON.stringify(r));
check("flagged as restart-required", r.ok && (r as { restartRequired?: boolean }).restartRequired === true);

const after = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
check("memory persisted", after.memoryLimit === 12, String(after.memoryLimit));
check("motd persisted", after.motd === "Season five starts Friday", String(after.motd));
check("whitelist toggled", after.whitelist === !base.whitelist);

const ev = (await db.activityEvent.findFirst({
  where: { action: "server.settings.updated" }, orderBy: { createdAt: "desc" },
}))!;
const ch = ev.changes as Record<string, { from: unknown; to: unknown }>;
check("audit event written", !!ev);
check("records exactly the 3 changed fields", Object.keys(ch).length === 3, Object.keys(ch).join(","));
check("heap from/to recorded", ch["Heap ceiling"]?.from === 8 && ch["Heap ceiling"]?.to === 12,
      JSON.stringify(ch["Heap ceiling"]));

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
