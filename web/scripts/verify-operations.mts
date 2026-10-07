import "./load-env.mts";

/* The ownership of a server's operations against a real Postgres: one claim wins, the others are told what has it, the lifecycle controls
   refuse what is another operation's moment, a beat is written while an operation runs and stops when it is over, and a server whose
   operation was cut short is given back, with a sentence and an audit line. No node is needed: this is the panel's own bookkeeping. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
process.env.OPERATION_BEAT_MS = "300";
const { claimServer, reapInterrupted, INSTANCE } = await import("../src/lib/operations");
const ops = await import("../src/lib/server-ops");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (slug: string) => db.server.findUniqueOrThrow({ where: { slug } });
const settle = (slug: string, data: Record<string, unknown> = {}) =>
  db.server.update({
    where: { slug },
    data: { state: "RUNNING", operation: null, operationOwner: null, operationStartedAt: null, operationBeat: null, stateBefore: null, lastError: null, ...data },
  });
const mara = (await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } }));

console.log("\n== two claims at once ==");
await settle("aurora");
const [one, two] = await Promise.all([claimServer((await read("aurora")).id, "backup"), claimServer((await read("aurora")).id, "backup")]);
const winners = [one, two].filter((c) => c.ok);
const losers = [one, two].filter((c) => !c.ok);
check("exactly one of two backups that begin together has the server", winners.length === 1 && losers.length === 1, JSON.stringify([one, two]));
check("the other is told what has it, and for how long", !losers[0]!.ok && /^Busy: a backup has been running for \d+ s\.$/.test((losers[0] as { sentence: string }).sentence), JSON.stringify(losers[0]));
let aurora = await read("aurora");
check("the server is BACKING_UP, and remembers what it was", aurora.state === "BACKING_UP" && aurora.stateBefore === "RUNNING", `${aurora.state}/${aurora.stateBefore}`);
check("whose it is, and what, and since when", aurora.operation === "backup" && aurora.operationOwner === INSTANCE && aurora.operationStartedAt !== null && aurora.operationBeat !== null);
const claimed = winners[0] as { since: Date };
check("the time it was written is the time that was meant (no zone slip)", aurora.operationStartedAt!.getTime() === claimed.since.getTime(), `${aurora.operationStartedAt?.toISOString()} vs ${claimed.since.toISOString()}`);

console.log("\n== while it holds the server ==");
const id = aurora.id;
const update = await claimServer(id, "update");
check("an update is refused, and by what", !update.ok && /Busy: a backup has been running/.test((update as { sentence: string }).sentence));
const refused = {
  delete: await ops.deleteServerOp(mara, "aurora", aurora.name),
  start: await ops.startServerOp(mara, "aurora"),
  stop: await ops.stopServerOp(mara, "aurora"),
  restart: await ops.restartServerOp(mara, "aurora"),
};
for (const [action, result] of Object.entries(refused)) {
  check(`${action} is refused with the same sentence`, !result.ok && /Busy: a backup has been running/.test(result.body), JSON.stringify(result));
}
check("and nothing was changed by them", (await read("aurora")).state === "BACKING_UP");

console.log("\n== it says it is alive, and stops when it is over ==");
const first = (await read("aurora")).operationBeat!.getTime();
await sleep(1_100);
const later = (await read("aurora")).operationBeat!.getTime();
check("a beat is written while the operation holds the server", later > first, `${first} -> ${later}`);
await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING" } });
await sleep(700);
const over = (await read("aurora")).operationBeat!.getTime();
await sleep(900);
check("and it stops when the state has moved on", (await read("aurora")).operationBeat!.getTime() === over);

console.log("\n== from where an operation may begin ==");
await settle("aurora", { state: "SUSPENDED" });
const suspended = await claimServer(id, "update");
check("a suspended server is refused, in words", !suspended.ok && /Busy: it is suspended/.test((suspended as { sentence: string }).sentence));
await settle("aurora", { state: "ERROR", lastError: "Update failed: x" });
const fromError = await claimServer(id, "rebuild");
check("a server in ERROR can be rebuilt: that is how it comes back", fromError.ok && fromError.stateBefore === "ERROR");
await settle("aurora", { state: "INSTALLING" });
check("one being installed cannot be updated", !(await claimServer(id, "update")).ok);
check("and the missing one is said to be missing", /no longer exists/.test(String(((await claimServer("no-such-server", "backup")) as { sentence?: string }).sentence)));

console.log("\n== an operation that was cut short ==");
await settle("aurora");
await db.server.update({
  where: { slug: "aurora" },
  data: { state: "UPDATING", operation: "update", operationOwner: "panel:deadbeef", operationStartedAt: new Date(Date.now() - 60_000), operationBeat: new Date(Date.now() - 30_000), stateBefore: "RUNNING" },
});
check("one that is merely quiet is left alone", (await reapInterrupted()).length === 0 && (await read("aurora")).state === "UPDATING");
check("the process of the same kind that has just started is not the one that held it", (await reapInterrupted({ afterStartOf: "poller" })).length === 0);
const given = await reapInterrupted({ afterStartOf: "panel" });
aurora = await read("aurora");
check("a panel that has just started gives back what the last panel held", given.length === 1 && given[0]!.slug === "aurora", JSON.stringify(given));
check("an update that was cut short is an error with a sentence and a way out", aurora.state === "ERROR" && /^An update did not finish: The panel was stopped while it ran\. .*rebuild it/.test(aurora.lastError ?? ""), `${aurora.state} ${aurora.lastError}`);
check("and the columns are clear", aurora.operation === null && aurora.operationOwner === null && aurora.operationBeat === null && aurora.stateBefore === null);
const event = await db.activityEvent.findFirst({ where: { serverId: aurora.id, action: "server.operation.interrupted" }, orderBy: { createdAt: "desc" } });
check("the audit log says so", !!event && event.actor === "Watchdog" && JSON.stringify(event.changes).includes("did not finish"));

console.log("\n== a backup that was cut short ==");
await settle("aurora");
const record = await db.backup.create({ data: { serverId: aurora.id, name: "manual-cut", sizeBytes: BigInt(0), trigger: "MANUAL", state: "RUNNING" } });
await db.server.update({
  where: { slug: "aurora" },
  data: { state: "BACKING_UP", operation: "backup", operationOwner: "poller:cafe0001", operationStartedAt: new Date(Date.now() - 400_000), operationBeat: new Date(Date.now() - 360_000), stateBefore: "RUNNING" },
});
const silent = await reapInterrupted();
aurora = await read("aurora");
check("silence of more than five minutes is enough, whoever held it", silent.length === 1 && silent[0]!.slug === "aurora");
check("the server is back to what it was, not in error", aurora.state === "RUNNING" && aurora.lastError === null);
check("the backup that never finished is marked failed, with why", (await db.backup.findUniqueOrThrow({ where: { id: record.id } })).state === "FAILED");
check("a live one is never reaped for silence: its own beats", await (async () => {
  await settle("aurora");
  const live = await claimServer(aurora.id, "backup");
  await sleep(700);
  const reaped = await reapInterrupted({ staleMs: 600 });
  await settle("aurora");
  return live.ok && reaped.length === 0;
})());

console.log("\n== a legacy row ==");
await db.server.update({ where: { slug: "aurora" }, data: { state: "UPDATING", operation: null, operationOwner: null, operationBeat: null, operationStartedAt: null } });
await db.$executeRaw`UPDATE "servers" SET "updatedAt" = now() - interval '10 minutes' WHERE "slug" = 'aurora'`;
const legacy = await reapInterrupted();
check("a server left UPDATING before these columns existed is given back once it has been still for five minutes", legacy.length === 1 && (await read("aurora")).state === "ERROR");

await settle("aurora");
await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
