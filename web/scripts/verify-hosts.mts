import "./load-env.mts";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

/* A server's address is a DNS name, and a DNS name has no case and one owner.

   Until 0.4.1 the address was stored as typed and compared exactly, so
   `Aurora.example.com` and `aurora.example.com` were two servers on one name,
   and two creates at the same moment on different nodes both passed the check
   in the code and both went in — five pairs in six, measured. The index on
   (node, port) kept the same node honest by accident. Now the address is
   lower-cased where it is written, and the database refuses a second one.

   This walks the code paths — create, the Settings save, both in pairs at once
   — and then the migration itself, on a database of its own, because what a
   migration does to data somebody already has is the half that is not seen
   until it runs. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { createServerOp } = await import("../src/lib/create-ops");
const { updateServerSettingsOp } = await import("../src/lib/server-ops");
const { uniqueViolation } = await import("../src/lib/db-errors");

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

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");
const ownDb = `${new URL(base).pathname.replace(/^\//, "")}_hosts`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const ownUrl = new URL(base);
ownUrl.pathname = `/${ownDb}`;
ownUrl.search = "";

async function admin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
const dropOwn = () =>
  admin(async (client) => {
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [ownDb]);
    await client.query(`DROP DATABASE IF EXISTS "${ownDb}"`);
  });

try {
  await seed();
  await syncCatalog({ offline: true });
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  const spec = (name: string, host: string, nodeName = "ash-node-01") => ({
    name,
    host,
    gameId: "terraria",
    versionId: "vanilla-1-4-5-8",
    templateId: "classic",
    nodeName,
    memoryGb: 1,
    cpuLimit: 50,
    diskGb: 5,
  });

  console.log("\n== a name has no case ==");
  let r = await createServerOp(mara, spec("Mixed One", "  Mixed.Case.Ashfold.GG "));
  const mixed = await db.server.findUnique({ where: { slug: "mixed-one" } });
  check("an address typed with capitals and spaces is created", r.ok, JSON.stringify(r));
  check("and kept as lower case, trimmed", mixed?.host === "mixed.case.ashfold.gg", mixed?.host);
  r = await createServerOp(mara, spec("Mixed Two", "MIXED.case.ashfold.gg"));
  check("the same address in other capitals is refused", !r.ok && r.title === "Address in use" && /Mixed One/.test(r.body), JSON.stringify(r));
  check("and nothing of it was written", (await db.server.count({ where: { slug: "mixed-two" } })) === 0);

  console.log("\n== two creates at the same moment, on two nodes ==");
  let twoOnOne = 0;
  let oneRefused = 0;
  const rounds = 6;
  for (let i = 0; i < rounds; i++) {
    const host = `race${i}.ashfold.gg`;
    const [a, b] = await Promise.all([
      createServerOp(mara, spec(`Race ${i} A`, host, "ash-node-01")),
      createServerOp(mara, spec(`Race ${i} B`, host, "fra-node-02")),
    ]);
    const rows = await db.server.count({ where: { host } });
    if (rows > 1) twoOnOne++;
    const refused = [a, b].filter((x) => !x.ok && (x.title === "Address in use" || x.title === "Just taken"));
    if (rows === 1 && a.ok !== b.ok && refused.length === 1) oneRefused++;
  }
  check(`no pair of ${rounds} left two servers on one address`, twoOnOne === 0, `${twoOnOne} pairs did`);
  check("every pair had one created and one told the address was in use", oneRefused === rounds, `${oneRefused} of ${rounds}`);

  console.log("\n== the database says so itself ==");
  const template = await db.server.findFirstOrThrow({ where: { host: "race0.ashfold.gg" } });
  type CreateData = Parameters<typeof db.server.create>[0]["data"];
  const copy: Record<string, unknown> = { ...template };
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  let error: unknown = null;
  try {
    await db.server.create({ data: { ...copy, slug: "direct-dup", host: template.host, port: template.port + 40 } as unknown as CreateData });
  } catch (e) {
    error = e;
  }
  check("a second row on an address is refused by the index, with its name", (uniqueViolation(error) ?? "").includes("servers_host_key"), String(uniqueViolation(error)));
  error = null;
  try {
    await db.server.create({ data: { ...copy, slug: "direct-upper", host: "UPPER.ashfold.gg", port: template.port + 41 } as unknown as CreateData });
  } catch (e) {
    error = e;
  }
  check("an address with capitals is refused by the check constraint", error !== null && /servers_host_lower/.test(String((error as Error).message)), String((error as Error | null)?.message).split("\n").pop());

  console.log("\n== the Settings save ==");
  const aurora = await db.server.findUniqueOrThrow({ where: { slug: "aurora" } });
  const settingsOf = (s: typeof aurora, host: string) => ({
    name: s.name,
    host,
    memoryLimit: s.memoryLimit,
    cpuLimit: s.cpuLimit,
    restartPolicy: s.restartPolicy,
    maxRestarts: s.maxRestarts,
  });
  r = await updateServerSettingsOp(mara, "aurora", settingsOf(aurora, "MIXED.case.ashfold.gg"));
  check("an address that is another server's is refused whatever its capitals", !r.ok && r.title === "Address in use", JSON.stringify(r));
  const nightfall = await db.server.findUniqueOrThrow({ where: { slug: "nightfall" } });
  const [sa, sb] = await Promise.all([
    updateServerSettingsOp(mara, "aurora", settingsOf(aurora, "moved.ashfold.gg")),
    updateServerSettingsOp(mara, "nightfall", settingsOf(nightfall, "moved.ashfold.gg")),
  ]);
  check("two saves to one new address at once: one saved, one told", sa.ok !== sb.ok && (await db.server.count({ where: { host: "moved.ashfold.gg" } })) === 1, JSON.stringify([sa.ok, sb.ok]));
  const lost = [sa, sb].find((x) => !x.ok);
  check("and the one told is told it is in use", lost !== undefined && !lost.ok && lost.title === "Address in use", JSON.stringify(lost));

  console.log("\n== reading which index lost ==");
  const adapter = (index: string) => ({
    code: "P2002",
    message: `Unique constraint failed on the constraint: \`${index}\``,
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { index }, table: "servers" } }, modelName: "Server" },
  });
  check("the driver adapter's shape names the index", uniqueViolation(adapter("servers_nodeId_port_key"))?.includes("_port_") === true && uniqueViolation(adapter("servers_host_key"))?.includes("_host_") === true);
  check("an older client's `meta.target` still does", uniqueViolation({ code: "P2002", meta: { target: ["nodeId", "port"] } }) === "nodeId port");
  check("the message alone does", uniqueViolation({ code: "P2002", message: "Unique constraint failed on the constraint: `servers_slug_key`" }) === "servers_slug_key");
  check("a violation that says nothing of which is still a violation", uniqueViolation({ code: "P2002" }) === "");
  check("anything else is not one", uniqueViolation(new Error("boom")) === null && uniqueViolation({ code: "P2025" }) === null && uniqueViolation(null) === null);

  console.log("\n== the migration, on a database of its own ==");
  await dropOwn();
  await admin((client) => client.query(`CREATE DATABASE "${ownDb}"`));
  const sql = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261001120000_server_host_unique", "migration.sql"), "utf8");
  const run = async (client: pg.Client, statement: string) => {
    try {
      await client.query(statement);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const scratch = new pg.Client({ connectionString: ownUrl.toString() });
  await scratch.connect();
  try {
    await scratch.query(`CREATE TABLE "servers" ("id" serial PRIMARY KEY, "name" text NOT NULL, "host" text NOT NULL)`);
    await scratch.query(`INSERT INTO "servers" ("name", "host") VALUES ('Aurora', 'Aurora.Example.com'), ('Aurora Two', 'aurora.example.com'), ('Solo', 'Solo.Example.com'), ('Other', 'other.example.com'), ('Other Too', 'OTHER.example.com')`);
    const refusal = await run(scratch, sql);
    check("with two servers on one name it stops", refusal !== null, "it ran");
    check("and names the address and both servers", /aurora\.example\.com: Aurora, Aurora Two/.test(refusal ?? "") && /other\.example\.com: Other, Other Too/.test(refusal ?? ""), refusal ?? "");
    check("and says what to do", /Change the address of all but one of each/.test(refusal ?? ""));
    const untouched = (await scratch.query(`SELECT "host" FROM "servers" ORDER BY "id"`)).rows.map((x) => x.host);
    check("and changes nothing", untouched.join() === "Aurora.Example.com,aurora.example.com,Solo.Example.com,other.example.com,OTHER.example.com", untouched.join());
    const noIndex = await scratch.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'servers_host_key'`);
    check("no index was left half made", noIndex.rows[0].n === 0);

    await scratch.query(`UPDATE "servers" SET "host" = 'aurora-two.example.com' WHERE "name" = 'Aurora Two'`);
    await scratch.query(`UPDATE "servers" SET "host" = 'other-too.example.com' WHERE "name" = 'Other Too'`);
    check("with each address its own it goes through", (await run(scratch, sql)) === null);
    const lowered = (await scratch.query(`SELECT "host" FROM "servers" ORDER BY "id"`)).rows.map((x) => x.host);
    check("and lower-cases what was there", lowered.join() === "aurora.example.com,aurora-two.example.com,solo.example.com,other.example.com,other-too.example.com", lowered.join());
    check("after it a second server on a name is refused", /servers_host_key/.test((await run(scratch, `INSERT INTO "servers" ("name", "host") VALUES ('Again', 'solo.example.com')`)) ?? ""));
    check("and a name with capitals is refused", /servers_host_lower/.test((await run(scratch, `INSERT INTO "servers" ("name", "host") VALUES ('Caps', 'Caps.example.com')`)) ?? ""));
  } finally {
    await scratch.end();
  }
} finally {
  await dropOwn().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
