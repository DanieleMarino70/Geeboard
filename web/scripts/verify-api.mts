import "./load-env.mts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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

// Every `METHOD route` this script has called, for the last section: which routes it never reached.
const reached = new Set<string>();

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
  reached.add(`${method} ${route}`);
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
  check("a refusal from the operation comes back under its own code", r.status === 404 && code(r) === "NODE_NOT_FOUND" && /no longer exists/.test(String(r.body.message)), JSON.stringify(r));
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

  console.log("\n== what the release work added ==");
  /* A key of its own: the budgets are per key, and these calls would
     otherwise spend the ten-a-minute the delete at the end needs — which
     is the limit doing its job, and a second client is how a real one
     would get round it. */
  const second = ((await createApiKeyOp(mara, "Everything, again", everything)) as { secret?: string }).secret!;
  r = await call(second, "GET", "servers/[id]/files/raw", { id: slug }, undefined, "?path=plugins/x.jar");
  check("a binary read says the node is not attached", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(readOnly, "PUT", "servers/[id]/files/raw", { id: slug }, { any: "body" }, "?path=plugins/x.jar");
  check("a binary write needs files:write", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(second, "PUT", "servers/[id]/files/raw", { id: slug }, { any: "body" }, "?path=plugins/x.jar");
  check("and is refused coded without an agent", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));

  const seeded = await db.backup.findFirstOrThrow({ where: { server: { slug: "aurora" } } });
  r = await call(second, "POST", "backups/[id]/verify", { id: seeded.id });
  check("verifying a record with no archive says nothing was checked", r.status === 200 && r.body.checked === false && r.body.intact === false, JSON.stringify(r).slice(0, 240));
  r = await call(readOnly, "POST", "backups/[id]/verify", { id: seeded.id });
  check("and needs backups:write", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");
  r = await call(readOnly, "GET", "backups", {}, undefined, "?deleted=true");
  check("the backups of deleted servers are listable, and there are none yet", r.status === 200 && (r.body.backups as unknown[]).length === 0, JSON.stringify(r));
  r = await call(readOnly, "GET", "backups");
  check("without the filter it is every backup the key may read", r.status === 200 && (r.body.backups as Array<{ deletedServer: unknown }>).length > 0 && (r.body.backups as Array<{ deletedServer: unknown }>)[0]!.deletedServer === null);
  r = await call(second, "POST", "backups/[id]/restore", { id: seeded.id }, { into: "wipe" });
  check("restoring into another server is refused for a backup that is not off-site", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));

  r = await call(second, "POST", "nodes/[name]/rotate-token", { name: "fra-node-02" });
  check("rotating the token of a node with no agent is a conflict", r.status === 409 && code(r) === "CONFLICT", JSON.stringify(r));
  r = await call(readOnly, "POST", "nodes/[name]/rotate-token", { name: "fra-node-02" });
  check("and needs nodes:manage", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE");

  r = await call(second, "DELETE", "servers/[id]", { id: slug }, { confirm: "Renamed by API", finalBackup: true });
  check(
    "a delete with a last backup that cannot be taken deletes nothing",
    r.status === 409 && /Not deleted/.test(String(r.body.message)) && (await db.server.count({ where: { slug } })) === 1,
    JSON.stringify(r),
  );

  console.log("\n== scheduled tasks ==");
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "Weekly check", kind: "verify", cron: "0 5 * * 0", payload: "download" });
  check("a verify task is created with its mode", r.status === 201 && r.body.kind === "VERIFY" && r.body.payload === "download", JSON.stringify(r));
  const verifyTaskId = String(r.body.id);
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "Bad check", kind: "VERIFY", cron: "0 5 * * 0", payload: "everything" });
  check("and refused with a mode that does not exist", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  await call(second, "DELETE", "tasks/[id]", { id: verifyTaskId });
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "Nightly", kind: "backup", cron: "0 4 * * *" });
  check("a task is created", r.status === 201 && r.body.kind === "BACKUP" && r.body.enabled === true, JSON.stringify(r));
  const taskId = String(r.body.id);
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "Too often", kind: "RESTART", cron: "* * * * *" });
  check("every minute is refused as the form refuses it", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "x", kind: "PAINT", cron: "0 4 * * *" });
  check("an unknown kind is refused", r.status === 400);
  r = await call(readOnly, "GET", "servers/[id]/tasks", { id: slug });
  check("tasks are readable with servers:read", r.status === 200 && (r.body.tasks as unknown[]).length === 2, JSON.stringify(r).slice(0, 120));
  r = await call(second, "PATCH", "tasks/[id]", { id: taskId }, { cron: "0 5 * * *" });
  check("a task is patched, other fields kept", r.status === 200 && r.body.cron === "0 5 * * *" && r.body.name === "Nightly", JSON.stringify(r));
  r = await call(second, "POST", "tasks/[id]/toggle", { id: taskId });
  check("a task is paused", r.status === 200 && r.body.enabled === false, JSON.stringify(r));
  r = await call(second, "POST", "tasks/[id]/run", { id: taskId });
  check("running it now answers with the task's own result, coded", (r.status === 202 || r.status === 409) && code(r) !== "INTERNAL", JSON.stringify(r));
  r = await call(readOnly, "DELETE", "tasks/[id]", { id: taskId });
  check("a read-only key cannot delete a task", r.status === 403);
  r = await call(second, "DELETE", "tasks/[id]", { id: taskId });
  check("a task is deleted", r.status === 200 && (await db.scheduledTask.findUnique({ where: { id: taskId } })) === null, JSON.stringify(r));
  r = await call(second, "GET", "tasks/[id]", { id: taskId });
  check("and gone", r.status === 404 && code(r) === "NOT_FOUND");

  console.log("\n== a server the caller cannot read is not found, like one that is not there ==");
  /* A member's key told 403 from 404, so a member could learn which names exist on the panel (the audit of 0.9.5). The member's key is written straight into
     the table: a member cannot make one through the page, which is the point of the check. */
  const bcrypt = (await import("bcryptjs")).default;
  const { randomBytes } = await import("node:crypto");
  const keyMember = await db.user.create({ data: { name: "Key Member", email: "keymember@verify.invalid", initials: "KM", role: "MEMBER", passwordHash: "x", passwordSetAt: new Date() } });
  const memberSecret = `gbk_live_${randomBytes(20).toString("hex")}`;
  await db.apiKey.create({
    data: {
      name: "member key",
      prefix: `gbk_live_${memberSecret.slice(9, 13)}…${memberSecret.slice(-4)}`,
      hash: await bcrypt.hash(memberSecret, 4),
      scopes: ["servers:read", "metrics:read"],
      userId: keyMember.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const there = await call(memberSecret, "GET", "servers/[id]", { id: slug });
  const missing = await call(memberSecret, "GET", "servers/[id]", { id: "no-such-server" });
  check("a member's key is told the same thing about a server it may not read and one that is not there", there.status === 404 && missing.status === 404 && code(there) === code(missing) && there.body.message === missing.body.message, JSON.stringify([there, missing]));
  const mine = await call(full, "GET", "servers/[id]", { id: slug });
  check("and an owner's key still reads it", mine.status === 200, JSON.stringify(mine).slice(0, 120));
  await db.apiKey.deleteMany({ where: { userId: keyMember.id } });
  await db.user.delete({ where: { id: keyMember.id } });

  console.log("\n== a task does what its kind stands for ==");
  /* A key issued to restart a server at night could, before, schedule a console command and run it, or schedule a cleanup and delete the
     backups: the routes asked only for the permission to schedule (the audit of 0.9.5). */
  minted = await createApiKeyOp(mara, "Scheduler only", ["servers:read", "servers:write"]);
  const schedulerOnly = (minted as { secret?: string }).secret!;
  for (const [kind, payload] of [["COMMAND", "op attacker"], ["BROADCAST", "hello"], ["CLEANUP", "keep 1"], ["BACKUP", ""], ["VERIFY", ""]] as const) {
    r = await call(schedulerOnly, "POST", "servers/[id]/tasks", { id: slug }, { name: `Sneaky ${kind}`, kind, cron: "0 4 * * *", payload });
    check(`servers:write alone cannot schedule a ${kind} task`, r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  }
  check("and none of them was made", (await db.scheduledTask.count({ where: { name: { startsWith: "Sneaky" } } })) === 0);
  r = await call(schedulerOnly, "POST", "servers/[id]/tasks", { id: slug }, { name: "Night restart", kind: "RESTART", cron: "0 4 * * *" });
  check("it can schedule the restart it was issued for", r.status === 201, JSON.stringify(r));
  const restartTaskId = String(r.body.id);
  r = await call(schedulerOnly, "PATCH", "tasks/[id]", { id: restartTaskId }, { kind: "COMMAND", payload: "op attacker" });
  check("and cannot turn it into a console command", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(second, "POST", "servers/[id]/tasks", { id: slug }, { name: "Say hi", kind: "BROADCAST", cron: "0 4 * * *", payload: "back in 5 minutes" });
  check("a key that may type in the console schedules a broadcast", r.status === 201, JSON.stringify(r));
  const broadcastId = String(r.body.id);
  r = await call(schedulerOnly, "POST", "tasks/[id]/run", { id: broadcastId });
  check("the scheduler-only key cannot run it", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(schedulerOnly, "POST", "tasks/[id]/toggle", { id: broadcastId });
  check("or enable and pause it", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(readOnly, "GET", "tasks/[id]", { id: broadcastId });
  check("a reader who may not watch the console does not read what it will say", r.status === 200 && r.body.payload === null && r.body.kind === "BROADCAST", JSON.stringify(r));
  r = await call(second, "GET", "tasks/[id]", { id: broadcastId });
  check("one who may, does", r.status === 200 && r.body.payload === "back in 5 minutes", JSON.stringify(r));
  r = await call(readOnly, "GET", "servers/[id]/tasks", { id: slug });
  const listed = (r.body.tasks as Array<{ id: string; payload: string | null }>).find((t) => t.id === broadcastId);
  check("and the list says the same", listed?.payload === null, JSON.stringify(listed));
  await call(second, "DELETE", "tasks/[id]", { id: broadcastId });
  await call(second, "DELETE", "tasks/[id]", { id: restartTaskId });

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

  /* A join password, and the text of a console command: each goes only
     to a caller who could change that setting or watch that console —
     the role and the key's scopes both. Until September 2026 both went
     to every reader, and every account is a reader. */
  console.log("\n== what a reader who may not change it is not given ==");
  const SECRET = "hunter2-verify";
  const keyFor = async (who: typeof mara, name: string, scopes: string[]) =>
    ((await createApiKeyOp(who, name, scopes)) as { secret?: string }).secret!;
  const member = await db.user.create({
    data: { email: "api-member@verify.invalid", name: "API Member", initials: "AM", role: "MEMBER", passwordHash: "not-a-hash", passwordSetAt: new Date() },
  });
  const keys = {
    owner: await keyFor(mara, "Secrets, everything", everything),
    ownerRead: await keyFor(mara, "Secrets, read and audit", ["servers:read", "audit:read"]),
    moderator: await keyFor(tomas, "Secrets, moderator", ["servers:read", "audit:read", "console:write"]),
  };
  /* A member holds nothing of the workspace and no key; a member's
     reach is the servers given to them, from the panel. What a key of
     theirs would be refused is what the role is refused, checked in
     verify-members through the ops. */
  const memberKey = await createApiKeyOp(member, "Secrets, member", ["servers:read"]);
  check("a member is not issued a key", !memberKey.ok && memberKey.title === "Not permitted", JSON.stringify(memberKey));
  r = await call(keys.owner, "POST", "servers", {}, {
    name: "API Terraria",
    host: "api-terraria.ashfold.gg",
    gameId: "terraria",
    versionId: "vanilla-1-4-5-8",
    templateId: "classic",
    nodeName: "ash-node-01",
    memoryGb: 1,
    cpuLimit: 100,
    diskGb: 5,
    settings: { password: SECRET },
  });
  check("a server with a join password is created", r.status === 201, JSON.stringify(r).slice(0, 300));
  const locked = String(r.body.slug);

  type GameAnswer = { stored: Record<string, unknown>; hidden: string[] };
  r = await call(keys.owner, "GET", "servers/[id]/settings", { id: locked });
  const own = r.body.game as GameAnswer;
  check("whoever may change the settings is given the password", r.status === 200 && own.stored.password === SECRET && own.hidden.length === 0, JSON.stringify(r).slice(0, 300));
  r = await call(keys.owner, "GET", "servers/[id]", { id: locked });
  check("in the server's own answer too", r.status === 200 && (r.body.settings as Record<string, unknown>).password === SECRET);
  for (const [who, key] of [["a key that may only read", keys.ownerRead], ["a moderator", keys.moderator]] as const) {
    r = await call(key, "GET", "servers/[id]/settings", { id: locked });
    check(
      `${who} is not given it, and is told it is hidden`,
      r.status === 200 && !JSON.stringify(r.body).includes(SECRET) && (r.body.game as GameAnswer).hidden.includes("password"),
      JSON.stringify(r).slice(0, 300),
    );
    r = await call(key, "GET", "servers/[id]", { id: locked });
    check(
      `${who} is not given it in the server's own answer either`,
      r.status === 200 && !JSON.stringify(r.body).includes(SECRET) && (r.body.hiddenSettings as string[]).includes("password"),
      JSON.stringify(r).slice(0, 300),
    );
  }

  r = await call(keys.owner, "PATCH", "servers/[id]/settings/game", { id: locked }, { values: { password: `${SECRET}-2` } });
  check("the password is changed", r.status === 200, JSON.stringify(r).slice(0, 300));
  const changed = await db.activityEvent.findFirst({
    where: { action: "server.config.updated", server: { slug: locked } },
    orderBy: { createdAt: "desc" },
  });
  const said = JSON.stringify(changed?.changes ?? null);
  check("the audit log says it changed, and not from what or to what", said.includes("Server password") && !said.includes(SECRET), said);

  // A command as the console op writes it; this node has no agent to send one to.
  const lockedRow = await db.server.findUniqueOrThrow({ where: { slug: locked } });
  await db.activityEvent.create({
    data: { actor: mara.name, action: "console.command", target: `password ${SECRET}`, tone: "ACCENT", userId: mara.id, serverId: lockedRow.id },
  });
  type Line = { action: string; target: string | null; targetHidden: boolean };
  const commandIn = (answer: typeof r) => (answer.body.events as Line[] | undefined)?.find((e) => e.action === "console.command");
  for (const [who, key] of [["a key without console:write", keys.ownerRead]] as const) {
    r = await call(key, "GET", "audit", {}, undefined, `?server=${locked}`);
    const line = commandIn(r);
    check(`${who} reads that a command was sent, and not what`, r.status === 200 && line?.target === null && line?.targetHidden === true && !JSON.stringify(r.body).includes(SECRET), JSON.stringify(line));
    r = await call(key, "GET", "audit", {}, undefined, `?q=${SECRET}`);
    check(`${who} cannot find it by searching for what it said`, r.status === 200 && r.body.total === 0, JSON.stringify(r.body).slice(0, 200));
  }
  r = await call(keys.moderator, "GET", "audit", {}, undefined, `?server=${locked}`);
  check("a moderator, who watches every console, reads it", commandIn(r)?.target === `password ${SECRET}` && commandIn(r)?.targetHidden === false, JSON.stringify(commandIn(r)));
  r = await call(keys.owner, "GET", "audit", {}, undefined, `?q=${SECRET}`);
  check("and its owner finds it by what it said", r.status === 200 && r.body.total === 1, JSON.stringify(r.body).slice(0, 200));

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

  console.log("\n== the mods routes ==");
  /* The operations are the Mods tab's own and verify:mods proves them
     against a real game; this is the plumbing — who may call what, and
     that a refusal comes back as a code. aurora is Minecraft, whose mods
     the panel does not install. */
  r = await call(null, "GET", "servers/[id]/mods", { id: "aurora" });
  check("the list needs a key", r.status === 401, JSON.stringify(r));
  r = await call(readOnly, "GET", "servers/[id]/mods", { id: "aurora" });
  check(
    "a read key reads a server's list, and is told this game takes none",
    r.status === 200 && (r.body as { supported?: boolean }).supported === false && Array.isArray((r.body as { mods?: unknown[] }).mods),
    JSON.stringify(r),
  );
  r = await call(readOnly, "POST", "servers/[id]/mods", { id: "aurora" }, { workshop: "3806120559" });
  check("a read key cannot add one", r.status === 403, JSON.stringify(r));
  r = await call(full, "POST", "servers/[id]/mods", { id: "aurora" }, {});
  check("adding needs a Workshop id", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(full, "POST", "servers/[id]/mods", { id: "aurora" }, { workshop: "3806120559" });
  check("and on a game whose mods it does not install, refused with the tab's own sentence", r.status === 400 && /does not install mods/.test(String(r.body.message)), JSON.stringify(r));
  r = await call(full, "PATCH", "servers/[id]/mods/[workshopId]", { id: "aurora", workshopId: "1" }, { enabled: "yes" });
  check("switching one takes true or false", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(full, "PUT", "servers/[id]/mods/order", { id: "aurora" }, { order: "3806120559" });
  check("an order is a list", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(second, "DELETE", "servers/[id]/mods/[workshopId]", { id: "aurora", workshopId: "1" });
  check("taking one off the list of a game that takes none is refused, coded", r.status >= 400 && r.status < 500 && r.status !== 429 && code(r) !== "INTERNAL" && code(r) !== "", JSON.stringify(r).slice(0, 200));
  r = await call(readOnly, "POST", "servers/[id]/mods/apply", { id: "aurora" });
  check("a read key cannot apply", r.status === 403, JSON.stringify(r));
  r = await call(readOnly, "DELETE", "servers/[id]/mods/collections/[collectionId]", { id: "aurora", collectionId: "3806120559" });
  check("nor remove a collection's mods", r.status === 403, JSON.stringify(r));

  console.log("\n== the routes the sections above did not reach ==");
  /* docs/api.md says this script calls every route. It did not: thirty of them had no call here, and the page read as if they had.
     These are the ones that were missing, each with the one answer the page promises for it; the last section of this script
     lists the routes it has not called, so the next one added without a call is a failure and not a sentence that stopped being true. */
  const third = ((await createApiKeyOp(mara, "Everything, a third time", everything)) as { secret?: string }).secret!;
  r = await call(third, "GET", "games");
  check("the games are listed", r.status === 200 && (r.body.games as Array<{ id: string }>).some((g) => g.id === "terraria"), JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "games/[id]", { id: "terraria" });
  check("one game, in the same shape", r.status === 200 && r.body.id === "terraria" && Array.isArray(r.body.settings), JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "games/[id]", { id: "no-such-game" });
  check("a game that is not there is a 404", r.status === 404, JSON.stringify(r));
  r = await call(third, "GET", "games/[id]/versions", { id: "terraria" });
  check("its versions, with the three latests", r.status === 200 && Array.isArray(r.body.versions) && typeof r.body.latest === "object", JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "nodes");
  check("the nodes are listed, and none carries a token or an address to call", r.status === 200 && Array.isArray(r.body.nodes) && !/token|daemonUrl/i.test(JSON.stringify(r.body)), JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "nodes/[name]", { name: "fra-node-02" });
  check("one node adds what is promised on it", r.status === 200 && r.body.committed !== undefined, JSON.stringify(r).slice(0, 200));
  r = await call(third, "GET", "nodes/[name]/metrics", { name: "fra-node-02" });
  check("a node's history is a list of points", r.status === 200 && Array.isArray(r.body.points) && r.body.range === "24h", JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "nodes/[name]/metrics", { name: "fra-node-02" }, undefined, "?range=2h");
  check("and a range that is not one of the five is a 400", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(third, "GET", "servers/[id]/metrics", { id: slug });
  check("a server's history is a list of points", r.status === 200 && Array.isArray(r.body.points) && r.body.server === slug, JSON.stringify(r).slice(0, 160));
  r = await call(third, "GET", "servers/[id]/metrics", { id: slug }, undefined, "?range=toString");
  check("a range that is a name on every object is still not a range", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(third, "GET", "servers", {}, undefined, "?state=SLEEPING");
  check("a state that is not one is a 400 that says which are, not a 500", r.status === 400 && code(r) === "VALIDATION_FAILED" && Array.isArray((r.body.details as { allowed?: unknown })?.allowed), JSON.stringify(r).slice(0, 200));
  r = await call(third, "GET", "servers", {}, undefined, "?state=running");
  check("and one that is, in any case, filters", r.status === 200 && Array.isArray(r.body.servers), JSON.stringify(r).slice(0, 120));
  r = await call(third, "GET", "servers/[id]/logs", { id: slug });
  check("logs say the node is not attached", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  for (const action of ["start", "stop", "restart"]) {
    r = await call(third, "POST", `servers/[id]/${action}`, { id: slug });
    check(`${action} answers 202 or a refusal with the reason, never a 500`, r.status === 202 || (r.status === 409 && code(r) === "SERVER_STATE_INVALID"), JSON.stringify(r).slice(0, 200));
  }
  r = await call(third, "POST", "servers/[id]/update", { id: slug }, { versionId: "paper-1-21-4" });
  check("an update to the version it is on is refused, coded", r.status === 409 && code(r) === "SERVER_STATE_INVALID", JSON.stringify(r).slice(0, 200));
  r = await call(third, "POST", "servers/[id]/files/directories", { id: slug }, { path: "mods" });
  check("a directory cannot be made on a node with no agent", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(third, "DELETE", "servers/[id]/files", { id: slug }, undefined, "?path=mods");
  check("nor a file removed", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(third, "PATCH", "servers/[id]/files", { id: slug }, { from: "mods/a.jar", to: "mods/b.jar" });
  check("nor a file renamed", r.status === 409 && code(r) === "RUNTIME_NOT_ATTACHED", JSON.stringify(r));
  r = await call(third, "PATCH", "servers/[id]/files", { id: slug }, { from: "mods/a.jar" });
  check("a rename without a destination is a coded 400", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(readOnly, "PATCH", "servers/[id]/files", { id: slug }, { from: "mods/a.jar", to: "mods/b.jar" });
  check("a rename needs files:write", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(third, "POST", "servers/[id]/mods/ask", { id: "aurora" });
  check("asking the node about mods of a game that takes none is refused, coded", r.status >= 400 && r.status < 500 && r.status !== 429 && code(r) !== "INTERNAL", JSON.stringify(r).slice(0, 200));
  r = await call(third, "POST", "servers/[id]/mods/collections", { id: "aurora" }, { collection: "3806120559" });
  check("a collection likewise", r.status >= 400 && r.status < 500 && r.status !== 429 && code(r) !== "INTERNAL", JSON.stringify(r).slice(0, 200));

  r = await call(third, "GET", "backups/[id]", { id: seeded.id });
  check("one backup, in the list's shape", r.status === 200 && r.body.id === seeded.id, JSON.stringify(r).slice(0, 160));
  r = await call(third, "POST", "backups/[id]/lock", { id: seeded.id }, { locked: true });
  check("a backup is locked", r.status === 200 && r.body.locked === true, JSON.stringify(r));
  r = await call(readOnly, "DELETE", "backups/[id]", { id: seeded.id });
  check("a read-only key cannot delete one", r.status === 403 && code(r) === "INSUFFICIENT_SCOPE", JSON.stringify(r));
  r = await call(third, "DELETE", "backups/[id]", { id: seeded.id });
  check("a locked one is a conflict, not a refusal of the state", r.status === 409 && code(r) === "CONFLICT", JSON.stringify(r));
  r = await call(third, "POST", "backups/[id]/lock", { id: seeded.id }, { locked: false });
  check("and is unlocked again", r.status === 200 && r.body.locked === false, JSON.stringify(r));
  r = await call(third, "POST", "backups/[id]/restore", { id: seeded.id }, { into: "" });
  check("an into that is there and empty is not read as none", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));
  r = await call(third, "POST", "backups/[id]/restore", { id: seeded.id }, { inPlace: "yes" });
  check("nor an inPlace that is not a boolean", r.status === 400 && code(r) === "VALIDATION_FAILED", JSON.stringify(r));

  r = await call(third, "POST", "servers/[id]/assign", { id: slug }, { member: "nobody@nowhere.invalid" });
  check("giving a server to an account that is not there is a 404", r.status === 404 && code(r) === "NOT_FOUND", JSON.stringify(r));
  r = await call(third, "POST", "servers/[id]/assign", { id: slug }, { member: "tomas@ashfold.gg" });
  check("a server is given", r.status === 200 && (await db.server.findUniqueOrThrow({ where: { slug } })).ownerId === tomas.id, JSON.stringify(r));
  r = await call(third, "POST", "servers/[id]/assign", { id: slug }, { member: "tomas@ashfold.gg" });
  check("giving it again is a conflict", r.status === 409 && code(r) === "CONFLICT", JSON.stringify(r));
  r = await call(third, "POST", "servers/[id]/assign", { id: slug }, { member: "mara@ashfold.gg" });
  check("and it goes back", r.status === 200 && (await db.server.findUniqueOrThrow({ where: { slug } })).ownerId === mara.id, JSON.stringify(r));

  console.log("\n== deleting the server ==");
  r = await call(full, "DELETE", "servers/[id]", { id: slug }, { confirm: "wrong" });
  check("the wrong name is refused", r.status === 400 && /does not match/.test(String(r.body.message)), JSON.stringify(r));
  r = await call(readOnly, "DELETE", "servers/[id]", { id: slug }, { confirm: "Renamed by API" });
  check("a read-only key cannot delete", r.status === 403);
  r = await call(full, "DELETE", "servers/[id]", { id: slug }, { confirm: "Renamed by API" });
  check("the right name deletes it", r.status === 200 && (await db.server.findUnique({ where: { slug } })) === null, JSON.stringify(r));
  r = await call(full, "GET", "servers/[id]", { id: slug });
  check("and it is gone", r.status === 404);

  console.log("\n== the routes no key opens ==");
  /* The three a machine calls. What they do for a real agent is verify:registration's, which serves them; here each is asked
     what nothing may be asked of it, and answers in the API's own shape. */
  r = await call(null, "GET", "panel-ca");
  const authority = String(r.body.raw ?? "");
  check(
    "the panel's authority is a certificate, or a coded 404",
    (r.status === 200 && /BEGIN CERTIFICATE/.test(authority)) || (r.status === 404 && code(r) === "NOT_FOUND" && typeof r.body.message === "string"),
    JSON.stringify(r).slice(0, 200),
  );
  r = await call(null, "POST", "nodes/register", {}, { token: "gbn_not-a-token", advertiseUrl: "http://nowhere.invalid:7777", agentToken: "x".repeat(40) });
  check("a registration with a token that was never minted is refused, coded", r.status >= 400 && r.status < 500 && code(r) !== "INTERNAL" && code(r) !== "", JSON.stringify(r).slice(0, 200));
  r = await call(null, "POST", "nodes/heartbeat", {}, { name: "no-such-node", token: "x".repeat(40) });
  check("a heartbeat for a node that is not there is refused, coded", r.status >= 400 && r.status < 500 && code(r) !== "INTERNAL" && code(r) !== "", JSON.stringify(r).slice(0, 200));

  console.log("\n== keys that are refused are counted against where they came from ==");
  /* The bcrypt compare is what a stranger can make this process do for the price of a request. The mask a key shows on the API keys page is enough to find
     its row, so a loop with that mask and a wrong middle paid a compare each time (the audit of 0.9.5). Last in the script: it refuses this source for a minute. */
  const realMask = full.slice(0, "gbk_live_".length + 4) + "x".repeat(full.length - "gbk_live_".length - 8) + full.slice(-4);
  let refusedAt = -1;
  for (let i = 0; i < 40 && refusedAt < 0; i++) {
    r = await call(realMask, "GET", "servers");
    if (r.status === 429) refusedAt = i;
    else if (r.status !== 401) check(`wrong key ${i} is refused as one`, false, JSON.stringify(r));
  }
  check("thirty keys refused in a minute close the door on that source", refusedAt >= 29 && refusedAt <= 31, String(refusedAt));
  r = await call(full, "GET", "servers");
  check("and while it is closed even a good key waits, without being read", r.status === 429 && code(r) === "RATE_LIMITED", JSON.stringify(r));

  console.log("\n== every route is called here ==");
  const API_DIR = path.join(import.meta.dirname, "..", "src", "app", "api", "v1");
  const existing: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") {
        const route = path.relative(API_DIR, path.dirname(full)).split(path.sep).join("/");
        const source = readFileSync(full, "utf8");
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          if (new RegExp(`export (?:async )?function ${method}\\b`).test(source)) existing.push(`${method} ${route}`);
        }
      }
    }
  };
  walk(API_DIR);
  const uncalled = existing.filter((route) => !reached.has(route));
  check(`all ${existing.length} handlers under /api/v1 were called by this script`, uncalled.length === 0, `not called: ${uncalled.join(", ")}`);
  const unknown = [...reached].filter((route) => !existing.includes(route));
  check("and it called none that is not there", unknown.length === 0, `not routes: ${unknown.join(", ")}`);
} finally {
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
