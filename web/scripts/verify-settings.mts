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

console.log("\n== a game setting fixed at creation ==");
/* Minecraft Java's world seed is read once, when the world is generated.
   Changing it was offered with a rebuild that took the server down to do
   nothing; it is refused now, before anything is written or rebuilt. The
   seeded server is given a game for this, as verify:catalog does. */
const { updateServerConfigOp } = await import("../src/lib/config-ops");
await db.server.update({ where: { slug: "creative" }, data: { gameId: "minecraft-java", config: { seed: "12345" } } });
let rc = await updateServerConfigOp(mara, "creative", { seed: "99999" }, { recreate: true });
check("a new seed is refused", !rc.ok && rc.title === "Set when the world was created", JSON.stringify(rc));
check("and says why", !rc.ok && /World seed only applies to a new world/.test(rc.body), JSON.stringify(rc));
rc = await updateServerConfigOp(mara, "creative", { seed: "99999", maxPlayers: 12 }, { recreate: true });
check("with another setting beside it, too", !rc.ok && rc.title === "Set when the world was created", JSON.stringify(rc));
const kept = (await db.server.findUnique({ where: { slug: "creative" } }))!;
check("the stored seed is untouched", (kept.config as { seed?: string }).seed === "12345", JSON.stringify(kept.config));
// The form sends the fixed value back as it shows it: that is not a change.
rc = await updateServerConfigOp(mara, "creative", { seed: "12345" });
check("the same seed sent back is nothing to save", !rc.ok && rc.title === "Nothing to save", JSON.stringify(rc));

console.log("\n== one save for the whole page ==");
/* The Settings page saves the game's settings and the server's own with one bar (lib/settings-save.ts). Both parts are checked before
   either is written, so a refusal of one writes nothing of the other, and each refusal comes back on the field it is about. */
const { saveSettingsOp } = await import("../src/lib/settings-save");
const creativeRow = async () => (await db.server.findUnique({ where: { slug: "creative" } }))!;
const creative0 = await creativeRow();
const creativeInput = {
  name: creative0.name, host: creative0.host, memoryLimit: creative0.memoryLimit,
  cpuLimit: creative0.cpuLimit, restartPolicy: creative0.restartPolicy, maxRestarts: creative0.maxRestarts,
};
const events = () => db.activityEvent.count({ where: { serverId: creative0.id, action: { in: ["server.settings.updated", "server.config.updated"] } } });
const events0 = await events();

// Minecraft Java's MOTD is an environment variable: it needs the server rebuilt, and is refused without one.
let rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, name: "Creative Two" }, game: { motd: "Hello" } });
check("a game change that needs a rebuild is refused without one", !rs.ok && rs.title === "This needs the server rebuilt" && rs.needsRebuild === true, JSON.stringify(rs));
check("and the server's own change beside it is not written either", (await creativeRow()).name === creative0.name, (await creativeRow()).name);

rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, name: "Creative Two" }, game: { maxPlayers: 100000 } });
check("a game value out of bounds is refused on its field", !rs.ok && rs.title === "Check the form" && /at most/i.test(rs.errors?.game?.maxPlayers ?? ""), JSON.stringify(rs));
check("with nothing written", (await creativeRow()).name === creative0.name && (await events()) === events0);

rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, host: "not a host" }, game: { maxPlayers: 12 } });
check("a bad address is refused on its field, with the game's change beside it", !rs.ok && Boolean(rs.errors?.server?.host), JSON.stringify(rs));
check("and the game's change is not written", ((await creativeRow()).config as { maxPlayers?: number } | null)?.maxPlayers !== 12, JSON.stringify((await creativeRow()).config));

rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, host: "aurora.ashfold.gg" }, game: { maxPlayers: 12 } });
// Two refusals at once, the game's (Max players is an environment variable too) and the address's: both are said, each where it belongs.
check("an address another server has is refused on its field", !rs.ok && /already the address of/i.test(rs.errors?.server?.host ?? ""), JSON.stringify(rs));
check("beside the game's refusal, both in one answer", !rs.ok && /recreated/.test(rs.body) && /already the address of/.test(rs.body), JSON.stringify(rs));

rs = await saveSettingsOp(mara, "creative", { server: creativeInput, game: { seed: "12345" } });
check("both parts unchanged is nothing to save", !rs.ok && rs.title === "Nothing to save", JSON.stringify(rs));

rs = await saveSettingsOp(tomas, "creative", { server: { ...creativeInput, name: "Creative Two" }, game: { maxPlayers: 12 } });
check("a moderator of another owner's server is refused both", !rs.ok && /permission|cannot change/i.test(rs.body), JSON.stringify(rs));

/* Terraria's settings are written to serverconfig.txt and read at the next restart: a save of both parts, on a server with no agent, writes
   both rows and says what each costs. */
await db.server.update({ where: { slug: "creative" }, data: { gameId: "terraria", config: { maxPlayers: 8 } } });
rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, name: "Creative Two", memoryLimit: creative0.memoryLimit === 6 ? 5 : 6 }, game: { maxPlayers: 12, motd: "One save" }, rebuild: true });
check("the game's settings and the server's own are saved together", rs.ok, JSON.stringify(rs));
const both = await creativeRow();
check("the server's own settings are written", both.name === "Creative Two" && both.memoryLimit !== creative0.memoryLimit, `${both.name} ${both.memoryLimit}`);
check("and the game's", (both.config as { maxPlayers?: number; motd?: string }).maxPlayers === 12 && (both.config as { motd?: string }).motd === "One save", JSON.stringify(both.config));
check("each part is in the audit log, as it was when they were two saves", (await events()) === events0 + 2, String((await events()) - events0));
check("the answer counts every change once", rs.ok && rs.body.startsWith("4 changes saved."), rs.body);
check("and says nothing was written to a server with no agent", rs.ok && rs.tone === "warning" && /no agent attached/.test(rs.body), rs.body);
check("a simulated server is not rebuilt for its new limits", rs.ok && rs.title === "Settings saved", JSON.stringify(rs));

rs = await saveSettingsOp(mara, "creative", { server: { ...creativeInput, name: "Creative Two", memoryLimit: both.memoryLimit }, game: { maxPlayers: 14 } });
check("a part that has not changed since is left out, and the other saved", rs.ok && rs.body.startsWith("1 change saved."), JSON.stringify(rs));
// Leave the fixture as the next script expects to find it.
await seed();

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
