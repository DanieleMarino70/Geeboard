import path from "node:path";
import process from "node:process";
import bcrypt from "bcryptjs";
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
const mara = await u("mara@ashfold.gg");   // OWNER
const devi = await u("devi@ashfold.gg");   // ADMIN
const tomas = await u("tomas@ashfold.gg"); // MODERATOR

console.log("\n== validation ==");
let r = await ops.createApiKeyOp(mara, "x", ["servers:read"]);
check("name under 2 chars rejected", !r.ok && r.title === "Name required");
r = await ops.createApiKeyOp(mara, "No scopes", []);
check("empty scope list rejected", !r.ok && r.title === "No scopes selected");
r = await ops.createApiKeyOp(mara, "Bad scope", ["servers:read", "not:a:scope"]);
check("unknown scope rejected", !r.ok && r.title === "Unknown scope", JSON.stringify(r));

console.log("\n== creating a key ==");
r = await ops.createApiKeyOp(mara, "CI pipeline", ["servers:write", "files:write"]);
check("creation succeeds", r.ok, JSON.stringify(r));
const secret = (r as { secret?: string }).secret!;
check("secret returned once", typeof secret === "string" && secret.startsWith("gbk_live_"), secret);
check("secret is 8 + 32 chars", secret.length === "gbk_live_".length + 32, String(secret.length));

const row = (await db.apiKey.findFirst({ where: { name: "CI pipeline" } }))!;
check("secret is NOT stored in the clear", row.hash !== secret && !row.hash.includes(secret.slice(9)));
check("stored value is a bcrypt hash", row.hash.startsWith("$2"), row.hash.slice(0, 4));
check("hash verifies against the secret", await bcrypt.compare(secret, row.hash));
check("prefix masks the middle", /^gbk_live_[0-9a-f]{4}…[0-9a-f]{4}$/.test(row.prefix), row.prefix);
const shown = row.prefix.slice("gbk_live_".length).replace(/[^0-9a-f]/g, "");
check("prefix leaks only 8 of the 32 secret chars", shown.length === 8, shown);
check("scopes persisted", row.scopes.join(",") === "servers:write,files:write", row.scopes.join(","));

r = await ops.createApiKeyOp(mara, "CI pipeline", ["servers:read"]);
check("duplicate active name rejected", !r.ok && r.title === "Name already used");

console.log("\n== two keys never collide ==");
const a = await ops.createApiKeyOp(mara, "Key A", ["metrics:read"]);
const b = await ops.createApiKeyOp(mara, "Key B", ["metrics:read"]);
check("secrets differ", (a as { secret?: string }).secret !== (b as { secret?: string }).secret);

console.log("\n== ownership ==");
await ops.createApiKeyOp(devi, "Devi bot", ["servers:read"]);
const deviKey = (await db.apiKey.findFirst({ where: { userId: devi.id, revokedAt: null } }))!;
r = await ops.revokeApiKeyOp(tomas, deviKey.id);
check("moderator cannot revoke someone else's key", !r.ok && r.title === "Not permitted", JSON.stringify(r));
r = await ops.revokeApiKeyOp(mara, deviKey.id);
check("owner can revoke anyone's key", r.ok, JSON.stringify(r));
check("revokedAt is set",
  (await db.apiKey.findUnique({ where: { id: deviKey.id } }))!.revokedAt !== null);
r = await ops.revokeApiKeyOp(mara, deviKey.id);
check("revoking twice refused", !r.ok && r.title === "Already revoked");

console.log("\n== delete requires revoke first ==");
r = await ops.deleteApiKeyOp(mara, row.id);
check("active key cannot be deleted", !r.ok && r.title === "Revoke it first", JSON.stringify(r));
await ops.revokeApiKeyOp(mara, row.id);
r = await ops.deleteApiKeyOp(mara, row.id);
check("revoked key deletes", r.ok, JSON.stringify(r));
check("row is gone", (await db.apiKey.findUnique({ where: { id: row.id } })) === null);

console.log("\n== audited ==");
check("every creation audited",
  (await db.activityEvent.count({ where: { action: "api_key.created" } })) === 4,
  String(await db.activityEvent.count({ where: { action: "api_key.created" } })));
check("revocation audited", (await db.activityEvent.count({ where: { action: "api_key.revoked" } })) >= 2);

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
