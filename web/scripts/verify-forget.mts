import "./load-env.mts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* A machine that is gone, and the servers the panel still lists on it. A delete asks the machine to remove the container first, and a move asks
   it too, so with the machine dead neither could be done, and the node could never be retired: the way out is a server's *forget*, which removes
   the panel's record and sends nothing. Against a stand-in agent that can be turned off, and a real Postgres. No Docker. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
const { deleteServerOp, setNodeDrainOp } = await import("../src/lib/server-ops");
const { removeNodeOp } = await import("../src/lib/node-ops");
const { encryptSecret } = await import("../src/lib/secrets");

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

const TOKEN = "forget-token-that-is-long-enough-to-be-ok!";
const NODE = "fg-node";

/* ── A stand-in agent: answers /health, can be told to fail it, and writes down every request it gets. ── */
const requests: string[] = [];
let mode: "up" | "failing" = "up";
const http = createServer((req: IncomingMessage, res: ServerResponse) => {
  requests.push(`${req.method} ${req.url}`);
  if (mode === "failing") {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "the engine is gone" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});
await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
const template = await db.server.findUniqueOrThrow({ where: { slug: "aurora" } });
const nodeTemplate = await db.node.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
const member = await db.user.findFirst({ where: { role: "MEMBER" } });

async function makeNode() {
  const base = { ...nodeTemplate } as Record<string, unknown>;
  for (const key of ["id", "createdAt", "name", "daemonUrl", "daemonToken", "state", "lastReachedAt", "reachDetail"]) delete base[key];
  for (const [key, value] of Object.entries(base)) if (value === null) delete base[key];
  return db.node.create({
    data: { ...(base as object), name: NODE, state: "HEALTHY", approvedAt: new Date(), lastReachedAt: new Date(), daemonUrl: url, daemonToken: encryptSecret(TOKEN) } as never,
  });
}
async function makeServer(nodeId: string, label: string, n: number) {
  const base = { ...template } as Record<string, unknown>;
  for (const key of ["id", "createdAt", "updatedAt", "slug", "name", "host", "port", "nodeId", "runtimeId", "state"]) delete base[key];
  for (const [key, value] of Object.entries(base)) if (value === null) delete base[key];
  return db.server.create({
    data: {
      ...(base as object), slug: `fg-${label}`, name: `Forget ${label}`, host: `fg-${label}.example.test`, port: 21_000 + n, nodeId, runtimeId: `stub-${label}`,
      state: "RUNNING", operation: null, operationOwner: null, operationStartedAt: null, operationBeat: null, stateBefore: null,
    } as never,
  });
}

try {
  const node = await makeNode();
  const a = await makeServer(node.id, "a", 1);
  const b = await makeServer(node.id, "b", 2);
  // A local backup goes with the server's disk; an off-site one stays, told what it was a backup of.
  await db.backup.create({ data: { serverId: b.id, name: "local-b", sizeBytes: BigInt(1000), trigger: "MANUAL", state: "COMPLETE", store: "LOCAL", artifact: "local-b.tar.gz" } });
  await db.backup.create({ data: { serverId: b.id, name: "offsite-b", sizeBytes: BigInt(2000), trigger: "MANUAL", state: "COMPLETE", store: "S3", artifact: "geeboard/offsite-b.tar.gz" } });

  console.log("\n== a node that answers is not forgotten from ==");
  let r = await deleteServerOp(mara, a.slug, a.name, { forget: true });
  check("forgetting is refused while the node answers", !r.ok && /answers/.test(r.body) && /Delete Forget a instead/.test(r.body), JSON.stringify(r));
  check("with a code a client can read", !r.ok && r.code === "SERVER_STATE_INVALID", JSON.stringify(r));
  check("and the server is still there", Boolean(await db.server.findUnique({ where: { id: a.id } })));
  check("the node was asked, and only whether it is there", requests.every((q) => q === "GET /health"), requests.join(" | "));

  r = await deleteServerOp(mara, a.slug, a.name, { forget: true, finalBackup: true });
  check("a last backup cannot be combined with it: that needs the node", !r.ok && r.code === "VALIDATION_FAILED" && /last backup/.test(r.body), JSON.stringify(r));

  console.log("\n== the machine is gone ==");
  mode = "failing";
  requests.length = 0;
  r = await deleteServerOp(mara, a.slug, a.name);
  check("a plain delete is refused, as it always was", !r.ok && /untouched/.test(r.body), JSON.stringify(r));
  check("and says where the way out is", !r.ok && /forget Forget a instead/.test(r.body) && /"forget": true/.test(r.body), JSON.stringify(r));
  check("the server is still there", Boolean(await db.server.findUnique({ where: { id: a.id } })));

  const blocked = await removeNodeOp(mara, NODE, NODE);
  check("the node cannot be removed with servers on it, and the sentence names forgetting", !blocked.ok && /forget them/.test(blocked.body), JSON.stringify(blocked));

  r = await deleteServerOp(mara, a.slug, "wrong name", { forget: true });
  check("forgetting asks for the server's name like a delete does", !r.ok && /does not match/.test(r.title), JSON.stringify(r));

  if (member) {
    r = await deleteServerOp(member, a.slug, a.name, { forget: true });
    check("whoever may not delete a server may not forget it", !r.ok, JSON.stringify(r));
  }

  requests.length = 0;
  r = await deleteServerOp(mara, a.slug, a.name, { forget: true });
  check("forgetting works once the node does not answer", r.ok, JSON.stringify(r));
  check("it says the machine was not asked, and what stays on it", r.ok && /nothing was removed there/.test(r.body) && /by hand/.test(r.body), JSON.stringify(r));
  check("the title says forgotten, not deleted", r.ok && /forgotten/.test(r.title), r.title);
  check("the server row is gone", !(await db.server.findUnique({ where: { id: a.id } })));
  check("nothing was sent to the machine but the question whether it is there", requests.every((q) => q === "GET /health"), requests.join(" | "));
  const line = await db.activityEvent.findFirst({ where: { action: "server.forgotten", target: a.name } });
  check("the audit log has a line for it", Boolean(line), "");
  check("which says the machine was not asked", JSON.stringify(line?.changes ?? {}).includes("On the machine"), JSON.stringify(line?.changes));
  check("and no server.deleted line was written for it", (await db.activityEvent.count({ where: { action: "server.deleted", target: a.name } })) === 0);
  check("the user is named", line?.actor === mara.name, String(line?.actor));

  console.log("\n== what stays, and the node after ==");
  r = await deleteServerOp(mara, b.slug, b.name, { forget: true });
  check("the second one goes the same way", r.ok, JSON.stringify(r));
  check("its local backup rows went with it", (await db.backup.count({ where: { name: "local-b" } })) === 0);
  const kept = await db.backup.findFirst({ where: { name: "offsite-b" } });
  check("its off-site backup stays, told what it was a backup of", kept !== null && kept.serverId === null && kept.originServerName === b.name, String(kept?.originServerName));

  const still = await removeNodeOp(mara, NODE, NODE);
  check("a node with nothing on it still has to be drained", !still.ok && /Drain/.test(still.body), JSON.stringify(still));
  const drained = await setNodeDrainOp(mara, NODE, true);
  check("it can be drained while it is dead", drained.ok, JSON.stringify(drained));
  const removed = await removeNodeOp(mara, NODE, NODE);
  check("and then removed from the panel", removed.ok, JSON.stringify(removed));
  check("the node row is gone", !(await db.node.findUnique({ where: { name: NODE } })));
  check("each step has its audit line", (await db.activityEvent.count({ where: { action: "server.forgotten", target: { in: [a.name, b.name] } } })) === 2 && Boolean(await db.activityEvent.findFirst({ where: { action: "node.removed", target: NODE } })));
} finally {
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await db.server.deleteMany({ where: { slug: { in: ["fg-a", "fg-b"] } } });
  await db.backup.deleteMany({ where: { name: { in: ["local-b", "offsite-b"] } } });
  await db.node.deleteMany({ where: { name: NODE } });
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
