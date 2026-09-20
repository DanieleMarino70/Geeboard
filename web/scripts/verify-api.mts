import path from "node:path";
import process from "node:process";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* The HTTP API, exercised with a real API key.

   The route handlers are ordinary functions of a Request, so they are
   called here directly — no Next server, no port — with a key minted
   through the same operation the API keys page uses. What this proves
   is the part the unit tests cannot: that a key's scopes and its owner's
   role both gate every route, that each route calls the same operation
   the panel does and answers with its refusal under a code, and that
   the shapes hold what the docs say. The routes that reach a node are
   proved against a node that is not there: the refusal is the contract,
   and verify:backups, verify:console and verify:files prove the reach. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { createApiKeyOp } = await import("../src/lib/server-ops");
const { syncCatalog } = await import("../src/lib/catalog-sync");

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

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const BASE = "http://panel.test";

/* A route module by its path under /api/v1, with the dynamic segments
   the file system would have bound. */
async function call(
  key: string | null,
  method: string,
  route: string,
  params: Record<string, string> = {},
  body?: unknown,
  query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const mod = (await import(`../src/app/api/v1/${route}/route`)) as Record<string, Handler>;
  const handler = mod[method];
  if (!handler) throw new Error(`${method} ${route} has no handler`);
  const req = new Request(`${BASE}/api/v1/${route}${query}`, {
    method,
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

const code = (r: { body: Record<string, unknown> }) => String(r.body.code ?? "");

try {
  await seed();
  await syncCatalog({ offline: true });
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  const tomas = await db.user.findUniqueOrThrow({ where: { email: "tomas@ashfold.gg" } });

  console.log("\n== keys ==");
  const everything = ["servers:read", "servers:write", "servers:manage", "console:write", "files:read", "files:write", "backups:write", "nodes:manage", "audit:read", "metrics:read"];
  let minted = await createApiKeyOp(mara, "Everything", everything);
  check("every scope can be issued now", minted.ok, JSON.stringify(minted));
  const full = (minted as { secret?: string }).secret!;
  minted = await createApiKeyOp(mara, "Read only", ["servers:read"]);
  const readOnly = (minted as { secret?: string }).secret!;
  minted = await createApiKeyOp(tomas, "Moderator manage", ["servers:manage", "servers:read"]);
  const moderator = (minted as { secret?: string }).secret!;

  let r = await call(null, "GET", "servers");
  check("no key, no answer", r.status === 401 && code(r) === "UNAUTHENTICATED", JSON.stringify(r));
  r = await call("gbk_live_notakey000000000000000000000", "GET", "servers");
  check("a wrong key is refused", r.status === 401, JSON.stringify(r));

  console.log("\n== creating a server ==");
  const input = {
    name: "API Made",
    host: "api-made.ashfold.gg",
    gameId: "minecraft-java",
    versionId: "paper-1-21-4",
    templateId: "survival",
    nodeName: "ash-node-01",
    memoryGb: 2,
    cpuLimit: 100,
    diskGb: 10,
    settings: { maxPlayers: 12 },
  };
  r = await call(readOnly, "POST", "servers", {}, input);
  check("a read-only key cannot create", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(moderator, "POST", "servers", {}, input);
  check("a moderator's key cannot create, whatever its scopes", r.status === 403 && code(r) === "FORBIDDEN", JSON.stringify(r));
  r = await call(full, "POST", "servers", {}, { ...input, memoryGb: "two" });
  check("a wrong type is a validation error", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(full, "POST", "servers", {}, { ...input, nodeName: "no-such-node" });
  check("a refusal from the operation comes back coded", r.status === 400 && /no longer exists/.test(String(r.body.message)), JSON.stringify(r));
  r = await call(full, "POST", "servers", {}, input);
  check("the server is created", r.status === 201 && r.body.slug === "api-made", JSON.stringify(r));
  const slug = String(r.body.slug);
  const stored = await db.server.findUniqueOrThrow({ where: { slug } });
  check("with the template and the settings sent", (stored.config as Record<string, unknown>).maxPlayers === 12);
  // "runtime":"DOCKER" is the platform's kind and fine to say; a
  // container id or an image name is not.
  check("no container or image in the shape", !JSON.stringify(r.body).match(/container|image/i));

  console.log("\n== reading and settings ==");
  r = await call(readOnly, "GET", "servers/[id]/settings", { id: slug });
  check("settings read with both halves", r.status === 200 && (r.body.platform as { name: string }).name === "API Made" && (r.body.game as { stored: Record<string, unknown> }).stored.maxPlayers === 12, JSON.stringify(r).slice(0, 200));
  r = await call(readOnly, "PATCH", "servers/[id]/settings", { id: slug }, { name: "Renamed" });
  check("a read-only key cannot change settings", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");
  r = await call(full, "PATCH", "servers/[id]/settings", { id: slug }, { name: "Renamed by API" });
  check("a partial patch changes one thing", r.status === 200 && (await db.server.findUniqueOrThrow({ where: { slug } })).name === "Renamed by API", JSON.stringify(r));
  r = await call(full, "PATCH", "servers/[id]/settings", { id: slug }, { restartPolicy: "SOMETIMES" });
  check("a bad policy is refused", r.status === 400 && code(r) === "VALIDATION_FAILED");
  /* maxPlayers is an environment setting for this game, so changing it
     means a new container: the operation says so and asks, the same
     way the settings page does, and the API passes that on as a 409
     with the plan. Saying `recreate` is the answer. */
  r = await call(full, "PATCH", "servers/[id]/settings/game", { id: slug }, { values: { maxPlayers: 20 } });
  check("a setting that needs a new container is a conflict with the plan", r.status === 409 && code(r) === "CONFLICT" && (r.body.details as { plan?: { needsRecreate: boolean } })?.plan?.needsRecreate === true, JSON.stringify(r).slice(0, 300));
  r = await call(full, "PATCH", "servers/[id]/settings/game", { id: slug }, { values: { maxPlayers: 20 }, recreate: true });
  check("game settings are saved through the same operation once recreate is agreed", r.status === 200, JSON.stringify(r));
  check("and stored", (((await db.server.findUniqueOrThrow({ where: { slug } })).config) as Record<string, unknown>).maxPlayers === 20);
  r = await call(full, "PATCH", "servers/[id]/settings/game", { id: slug }, { values: { nope: 1 } });
  check("an unknown setting is refused", r.status === 400 && /no setting called nope/.test(String(r.body.message)), JSON.stringify(r));

  console.log("\n== routes that reach the node, against a node that is not there ==");
  r = await call(full, "POST", "servers/[id]/console", { id: slug }, { command: "say hi" });
  check("console refused with a code, not a 500", r.status >= 400 && r.status < 500 && code(r) !== "INTERNAL", JSON.stringify(r));
  r = await call(readOnly, "POST", "servers/[id]/console", { id: slug }, { command: "say hi" });
  check("console needs console:write", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");
  r = await call(full, "GET", "servers/[id]/files", { id: slug }, undefined, "?path=/");
  check("files list says the node is not attached", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(full, "PUT", "servers/[id]/files/content", { id: slug }, { content: "x" }, "?path=a.txt");
  check("files write likewise", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(full, "GET", "servers/[id]/files/content", { id: slug });
  check("a missing path is a validation error", r.status === 400 && code(r) === "VALIDATION_FAILED");
  r = await call(full, "POST", "servers/[id]/backups", { id: slug }, {});
  check("a backup is refused without an agent, coded", r.status === 409 && code(r) !== "INTERNAL", JSON.stringify(r));
  r = await call(full, "POST", "servers/[id]/backups", { id: slug }, { store: "S3" });
  // The operation asks for the agent before it asks for the bucket, so
  // on this node the missing agent is what it says; either way, coded.
  check("an off-site backup is refused by the operation, coded", r.status === 409 && code(r) === "SERVER_STATE_INVALID" && /No agent|No off-site storage/.test(String(r.body.message)), JSON.stringify(r));
  r = await call(full, "GET", "servers/[id]/backups", { id: slug });
  check("the backup list is empty and readable", r.status === 200 && Array.isArray(r.body.backups) && (r.body.backups as unknown[]).length === 0);
  r = await call(full, "POST", "servers/[id]/rollback", { id: slug });
  check("rollback with no way back is refused, coded", r.status === 409, JSON.stringify(r));
  r = await call(full, "POST", "servers/[id]/move", { id: slug }, { node: "fra-node-02" });
  // A simulated creation leaves the server starting, which the move
  // refuses before it looks for a bucket; a refusal from the operation,
  // whichever it is, comes back coded and not as a 500.
  check("a move is refused by the operation, coded", r.status === 409 && code(r) === "SERVER_STATE_INVALID" && /Busy|No off-site storage/.test(String(r.body.message)), JSON.stringify(r));

  console.log("\n== scheduled tasks ==");
  r = await call(full, "POST", "servers/[id]/tasks", { id: slug }, { name: "Nightly", kind: "backup", cron: "0 4 * * *" });
  check("a task is created", r.status === 201 && r.body.kind === "BACKUP" && r.body.enabled === true, JSON.stringify(r));
  const taskId = String(r.body.id);
  r = await call(full, "POST", "servers/[id]/tasks", { id: slug }, { name: "Too often", kind: "RESTART", cron: "* * * * *" });
  check("every minute is refused as the form refuses it", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(full, "POST", "servers/[id]/tasks", { id: slug }, { name: "x", kind: "PAINT", cron: "0 4 * * *" });
  check("an unknown kind is refused", r.status === 400);
  r = await call(readOnly, "GET", "servers/[id]/tasks", { id: slug });
  check("tasks are readable with servers:read", r.status === 200 && (r.body.tasks as unknown[]).length === 2, JSON.stringify(r).slice(0, 120));
  r = await call(full, "PATCH", "tasks/[id]", { id: taskId }, { cron: "0 5 * * *" });
  check("a task is patched, other fields kept", r.status === 200 && r.body.cron === "0 5 * * *" && r.body.name === "Nightly", JSON.stringify(r));
  r = await call(full, "POST", "tasks/[id]/toggle", { id: taskId });
  check("a task is paused", r.status === 200 && r.body.enabled === false, JSON.stringify(r));
  r = await call(full, "POST", "tasks/[id]/run", { id: taskId });
  check("running it now answers with the task's own result, coded", (r.status === 202 || r.status === 409) && code(r) !== "INTERNAL", JSON.stringify(r));
  r = await call(readOnly, "DELETE", "tasks/[id]", { id: taskId });
  check("a read-only key cannot delete a task", r.status === 403);
  r = await call(full, "DELETE", "tasks/[id]", { id: taskId });
  check("a task is deleted", r.status === 200 && (await db.scheduledTask.findUnique({ where: { id: taskId } })) === null, JSON.stringify(r));
  r = await call(full, "GET", "tasks/[id]", { id: taskId });
  check("and gone", r.status === 404 && code(r) === "NOT_FOUND");

  console.log("\n== audit ==");
  r = await call(readOnly, "GET", "audit");
  check("the audit log needs audit:read", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");
  r = await call(full, "GET", "audit", {}, undefined, `?server=${slug}`);
  const events = r.body.events as Array<{ action: string }>;
  // Created on a node with no agent, so the creation was simulated and
  // its event says so; whatever came after it is what is on top.
  check("the server's events are there, newest first", r.status === 200 && events.some((e) => e.action === "server.created.simulated") && events[0]!.action !== "server.created.simulated", JSON.stringify(r).slice(0, 200));
  r = await call(full, "GET", "audit", {}, undefined, "?page=0");
  check("a bad page is a validation error", r.status === 400);

  console.log("\n== nodes ==");
  r = await call(readOnly, "POST", "nodes/[name]/drain", { name: "fra-node-02" }, { drain: true });
  check("draining needs nodes:manage", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");
  r = await call(full, "POST", "nodes/[name]/drain", { name: "fra-node-02" }, { drain: true });
  check("a node drains", r.status === 200 && (await db.node.findUniqueOrThrow({ where: { name: "fra-node-02" } })).state === "DRAINING", JSON.stringify(r));
  r = await call(full, "POST", "nodes/[name]/drain", { name: "fra-node-02" }, { drain: true });
  check("draining twice is a conflict", r.status === 409 && code(r) === "CONFLICT", JSON.stringify(r));
  r = await call(full, "POST", "nodes/[name]/drain", { name: "fra-node-02" }, { drain: false });
  check("and comes back", r.status === 200);
  r = await call(full, "POST", "nodes/[name]/drain", { name: "nowhere" }, { drain: true });
  check("an unknown node is 404", r.status === 404 && code(r) === "NODE_NOT_FOUND", JSON.stringify(r));
  r = await call(full, "POST", "nodes/[name]/approve", { name: "fra-node-02" });
  check("approving an approved node is a conflict", r.status === 409, JSON.stringify(r));
  r = await call(full, "POST", "nodes/[name]/reject", { name: "nowhere" });
  check("rejecting an unknown node is 404", r.status === 404, JSON.stringify(r));
  r = await call(full, "DELETE", "nodes/[name]", { name: "ash-node-01" }, { confirm: "ash-node-01" });
  check("a node with servers cannot be removed", r.status === 409 && /hosts/.test(String(r.body.message)), JSON.stringify(r));

  console.log("\n== deleting the server ==");
  r = await call(full, "DELETE", "servers/[id]", { id: slug }, { confirm: "wrong" });
  check("the wrong name is refused", r.status === 400 && /does not match/.test(String(r.body.message)), JSON.stringify(r));
  r = await call(readOnly, "DELETE", "servers/[id]", { id: slug }, { confirm: "Renamed by API" });
  check("a read-only key cannot delete", r.status === 403);
  r = await call(full, "DELETE", "servers/[id]", { id: slug }, { confirm: "Renamed by API" });
  check("the right name deletes it", r.status === 200 && (await db.server.findUnique({ where: { slug } })) === null, JSON.stringify(r));
  r = await call(full, "GET", "servers/[id]", { id: slug });
  check("and it is gone", r.status === 404);
} finally {
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
