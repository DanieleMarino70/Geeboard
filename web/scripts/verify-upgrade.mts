import "./load-env.mts";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";

/* The upgrade from a release that is already installed, run for real.

   A database is brought to the state 0.4.1 left it in — by applying only the
   migrations that release had — and given the rows an installation has. Then
   this checkout's migrations are applied to it, the way \`panel migrate\` does,
   and what an upgrade promises is checked: every count survives, the 0.7.0
   migration (which moves a server's DNS address out of four columns of
   \`servers\` into a row of its own, and drops them) writes a row for each address
   there was, Prisma and the schema file agree about the result, and each
   migration's time is recorded. Then a migration that fails is made to fail, the
   way the panel and the installer would meet it: the schema check names it,
   \`resolve\` puts it right, and applying again finishes the job.

   Never the database DATABASE_URL names — a sibling called <name>_upgrade, made
   for the run and dropped after it. */

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");

/* The last migration 0.4.1 carried. Everything after it came with 0.5.0 or later, and an applied migration is
   never edited (docs/upgrading.md): that is what makes "the migrations up to here" the schema of that release. */
const LAST_OF_0_4_1 = "20261001150000_node_contract";

const parentUrl = new URL(base);
const upgradeDb = `${parentUrl.pathname.replace(/^\//, "")}_upgrade`;
const upgradeUrl = new URL(base);
upgradeUrl.pathname = `/${upgradeDb}`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
adminUrl.search = "";

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

const WEB = process.cwd();
const real = path.join(WEB, "prisma", "migrations");
const prismaBin = path.join(path.dirname(createRequire(import.meta.url).resolve("prisma/package.json")), "build", "index.js");

/* A directory laid out the way a checkout is — <root>/prisma/migrations — holding the migrations it is given, and a
   Prisma config that points at it. The config sits inside web/ so that `prisma/config` resolves from node_modules. */
const work = await mkdtemp(path.join(tmpdir(), "geeboard-upgrade-"));
const configDir = path.join(WEB, ".verify-upgrade");
await mkdir(configDir, { recursive: true });

async function lay(name: string, migrations: string[]): Promise<{ root: string; config: string }> {
  const root = path.join(work, name);
  const dir = path.join(root, "prisma", "migrations");
  await mkdir(dir, { recursive: true });
  for (const migration of migrations) await cp(path.join(real, migration), path.join(dir, migration), { recursive: true });
  await cp(path.join(real, "migration_lock.toml"), path.join(dir, "migration_lock.toml"));
  const config = path.join(configDir, `${name}.config.ts`);
  await writeFile(
    config,
    `import { defineConfig, env } from "prisma/config";\n` +
      `export default defineConfig({\n` +
      `  schema: ${JSON.stringify(path.join(WEB, "prisma", "schema.prisma"))},\n` +
      `  migrations: { path: ${JSON.stringify(dir)} },\n` +
      `  datasource: { url: env("DATABASE_URL") },\n` +
      `});\n`,
  );
  return { root, config };
}

function prisma(args: string[], config: string) {
  const run = spawnSync(process.execPath, [prismaBin, ...args, "--config", config], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: upgradeUrl.toString() },
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const dropDatabase = () =>
  admin(async (client) => {
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [upgradeDb]);
    await client.query(`DROP DATABASE IF EXISTS "${upgradeDb}"`);
  });

/* A row, with every column that must have a value given one: the ones named win, the rest are filled by type. Whatever
   the schema of the release being simulated asks for is read from the database rather than written here, so this fixture
   cannot drift from a migration it has never heard of. */
async function insertRow(client: pg.Client, table: string, given: Record<string, unknown>): Promise<void> {
  const columns = await client.query<{ column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; character_maximum_length: number | null }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const row: Record<string, unknown> = {};
  for (const column of columns.rows) {
    if (column.column_name in given) {
      row[column.column_name] = given[column.column_name];
      continue;
    }
    if (column.is_nullable === "YES" || column.column_default !== null) continue;
    if (column.data_type === "USER-DEFINED") {
      const labels = await client.query<{ enumlabel: string }>(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [column.udt_name]);
      row[column.column_name] = labels.rows[0]!.enumlabel;
    } else if (/char|text/.test(column.data_type)) {
      // Cut to what the column holds: `initials` is two characters.
      row[column.column_name] = `${table}-${column.column_name}-${Math.random().toString(36).slice(2, 8)}`.slice(0, column.character_maximum_length ?? undefined);
    }
    else if (/int|numeric|double|real/.test(column.data_type)) row[column.column_name] = 1;
    else if (column.data_type === "boolean") row[column.column_name] = false;
    else if (/timestamp|date/.test(column.data_type)) row[column.column_name] = new Date();
    else if (column.data_type === "jsonb" || column.data_type === "json") row[column.column_name] = "{}";
    else throw new Error(`no filler for ${table}.${column.column_name} (${column.data_type})`);
  }
  const names = Object.keys(row);
  await client.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
}

const client = new pg.Client({ connectionString: upgradeUrl.toString() });
// The database is dropped from under it in the end; that is not an event anybody has to hear about.
client.on("error", () => {});
const migrationNames = (await readdir(real, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const until = migrationNames.indexOf(LAST_OF_0_4_1);

try {
  console.log("\n== the schema 0.4.1 left, with an installation's rows in it ==");
  check("this checkout still has the migration 0.4.1 ended on", until > 0, LAST_OF_0_4_1);
  check("and migrations after it, which are what an upgrade has to apply", migrationNames.length - until - 1 >= 6, `${migrationNames.length - until - 1} after`);
  await dropDatabase();
  await admin((client) => client.query(`CREATE DATABASE "${upgradeDb}"`));

  const old = await lay("old", migrationNames.slice(0, until + 1));
  const first = prisma(["migrate", "deploy"], old.config);
  check(`the ${until + 1} migrations of 0.4.1 apply to an empty database`, first.status === 0, first.out.slice(-400));

  await client.connect();
  const counts = async (tables: string[]) => {
    const out: Record<string, number> = {};
    // One query at a time: a single connection does not take them side by side.
    for (const t of tables) out[t] = Number((await client.query(`SELECT count(*) FROM "${t}"`)).rows[0].count);
    return out;
  };

  await insertRow(client, "users", { id: "u_owner", email: "owner@upgrade.test", role: "OWNER" });
  await insertRow(client, "users", { id: "u_member", email: "member@upgrade.test", role: "MEMBER" });
  await insertRow(client, "nodes", { id: "n_one", name: "upgrade-node" });
  // Three servers: an IPv4 record, an IPv6 one, and one that only ever had an error and no address.
  await insertRow(client, "servers", { id: "s_a", slug: "alpha", port: 25565, host: "alpha.upgrade.test", ownerId: "u_owner", nodeId: "n_one", dnsAddress: "203.0.113.10", dnsRecordId: "rec-a", dnsError: null });
  await insertRow(client, "servers", { id: "s_b", slug: "bravo", port: 25566, host: "bravo.upgrade.test", ownerId: "u_owner", nodeId: "n_one", dnsAddress: "2001:db8::7", dnsRecordId: "rec-b", dnsError: null });
  await insertRow(client, "servers", { id: "s_c", slug: "charlie", port: 25567, host: "charlie.upgrade.test", ownerId: "u_member", nodeId: "n_one", dnsAddress: null, dnsRecordId: null, dnsError: "provider said no" });
  await insertRow(client, "backups", { id: "b_1", serverId: "s_a", name: "manual-10-01", state: "COMPLETE" });
  await insertRow(client, "backups", { id: "b_2", serverId: "s_b", name: "auto-10-01", state: "FAILED" });
  await insertRow(client, "scheduled_tasks", { id: "t_1", serverId: "s_a", name: "Nightly", kind: "BACKUP", cron: "0 3 * * *" });

  /* How 0.4.1 left two of them: running, and judged healthy, with no record of when the console said it was ready (it did not always write
     one); and one that its panel had already called unhealthy. */
  await client.query(`UPDATE servers SET state = 'RUNNING', "startedAt" = now() - interval '2 hours', "readyAt" = NULL WHERE id = 's_a'`);
  await client.query(`UPDATE servers SET state = 'UNHEALTHY', "startedAt" = now() - interval '2 hours', "readyAt" = NULL WHERE id = 's_b'`);

  const TABLES = ["users", "nodes", "servers", "backups", "scheduled_tasks"];
  const before = await counts(TABLES);
  check("the fixture is in", before.users === 2 && before.servers === 3 && before.backups === 2, JSON.stringify(before));

  console.log("\n== a panel of this release meets that database before it is migrated ==");
  const { checkSchema, describeSchema } = await import("../src/lib/schema-check");
  const prismaClientLike = { $queryRawUnsafe: async <T,>(query: string) => (await client.query(query)).rows as T };
  let verdict = await checkSchema(prismaClientLike, WEB);
  check("the schema check says it is a release behind", verdict !== "unknown" && !verdict.ok && verdict.kind === "behind", JSON.stringify(verdict));
  if (verdict !== "unknown" && !verdict.ok) {
    const said = describeSchema(verdict, "0.9.0", true);
    check("in one sentence with the migration it lacks, and the command", /a release behind/.test(said.line) && /run --rm panel migrate/.test(said.fix), `${said.line} | ${said.fix}`);
  }

  console.log("\n== applying this checkout's migrations ==");
  const full = await lay("full", migrationNames);
  const started = Date.now();
  const applied = prisma(["migrate", "deploy"], full.config);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  check(`they apply (${seconds} s)`, applied.status === 0, applied.out.slice(-600));
  const newOnes = (await client.query<{ migration_name: string; took: number }>(
    `SELECT migration_name, extract(epoch from (finished_at - started_at))::float AS took FROM "_prisma_migrations" WHERE migration_name > $1 ORDER BY migration_name`,
    [LAST_OF_0_4_1],
  )).rows;
  check("every migration after 0.4.1 is recorded as finished", newOnes.length === migrationNames.length - until - 1 && newOnes.every((m) => m.took !== null), String(newOnes.length));
  for (const m of newOnes) console.log(`       ${m.migration_name.padEnd(46)} ${m.took.toFixed(2)} s`);
  check("none takes long enough to matter on a panel this size", newOnes.every((m) => m.took < 30));

  const after = await counts(TABLES);
  check("every count survives", JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  console.log("\n== what a running server is left with ==");
  /* Found upgrading a real 0.4.1 panel: its two running Terraria servers came back UNHEALTHY, "the console has not reported it ready",
     because their readiness had never been written down and the line was out of the 120 the check reads. */
  const readiness = (await client.query<{ id: string; ready: boolean; same: boolean | null }>(`SELECT id, "readyAt" IS NOT NULL AS ready, "readyAt" = "startedAt" AS same FROM servers ORDER BY id`)).rows;
  check("a server that was running has its readiness written down, as the run's own start", readiness.find((r) => r.id === "s_a")?.ready === true && readiness.find((r) => r.id === "s_a")?.same === true, JSON.stringify(readiness));
  check("one that was unhealthy is left to be looked at", readiness.find((r) => r.id === "s_b")?.ready === false, JSON.stringify(readiness));
  check("and one that was stopped has nothing to write", readiness.find((r) => r.id === "s_c")?.ready === false, JSON.stringify(readiness));

  console.log("\n== what the DNS migration moved ==");
  const records = (await client.query<{ serverId: string; kind: string; name: string; content: string; providerRecordId: string }>(`SELECT "serverId", kind, name, content, "providerRecordId" FROM server_dns_records ORDER BY "serverId"`)).rows;
  check("one row for each address there was", records.length === 2, JSON.stringify(records));
  check("the IPv4 address is an A record under the server's host", records.some((r) => r.serverId === "s_a" && r.kind === "A" && r.name === "alpha.upgrade.test" && r.content === "203.0.113.10" && r.providerRecordId === "rec-a"));
  check("the IPv6 address is an AAAA record", records.some((r) => r.serverId === "s_b" && r.kind === "AAAA" && r.content === "2001:db8::7"));
  check("a server that only had an error gets no row", !records.some((r) => r.serverId === "s_c"));
  const leftover = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'servers' AND column_name LIKE 'dns%'`);
  check("and the four columns are gone", leftover.rowCount === 0, JSON.stringify(leftover.rows));

  console.log("\n== the database and the schema file agree ==");
  const diff = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", path.join(WEB, "prisma", "schema.prisma"), "--exit-code"], full.config);
  check("prisma migrate diff finds nothing to change", diff.status === 0, diff.out.slice(-500));
  const status = prisma(["migrate", "status"], full.config);
  check("migrate status says it is up to date", status.status === 0 && /up to date/i.test(status.out), status.out.slice(-300));
  verdict = await checkSchema(prismaClientLike, WEB);
  check("and so does the schema check", verdict !== "unknown" && verdict.ok, JSON.stringify(verdict));

  console.log("\n== a database a newer release migrated, under an older panel ==");
  await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('x', 'x', '29990101000000_from_the_future', now(), now(), 1)`);
  verdict = await checkSchema(prismaClientLike, WEB);
  check("is ahead, and named", verdict !== "unknown" && !verdict.ok && verdict.kind === "ahead" && verdict.unknown.includes("29990101000000_from_the_future"), JSON.stringify(verdict));
  await client.query(`DELETE FROM "_prisma_migrations" WHERE id = 'x'`);

  console.log("\n== a migration that fails ==");
  const broken = await lay("broken", migrationNames);
  const brokenName = "29990102000000_verify_broken";
  const brokenDir = path.join(broken.root, "prisma", "migrations", brokenName);
  await mkdir(brokenDir, { recursive: true });
  await writeFile(path.join(brokenDir, "migration.sql"), `CREATE TABLE "verify_half_done" ("id" INT);\nSELECT 1 / 0;\n`);
  const failed = prisma(["migrate", "deploy"], broken.config);
  check("Prisma stops, and its words say which migration and why", failed.status !== 0 && failed.out.includes(brokenName) && /division by zero/i.test(failed.out), failed.out.slice(-500));
  const halfDone = await client.query(`SELECT to_regclass('verify_half_done') AS t`);
  check("what it did before it stopped is still there: it is not rolled back for you", halfDone.rows[0].t !== null);
  verdict = await checkSchema(prismaClientLike, broken.root);
  check("the schema check names the failed migration", verdict !== "unknown" && !verdict.ok && verdict.kind === "failed" && verdict.failed.includes(brokenName), JSON.stringify(verdict));

  const resolved = prisma(["migrate", "resolve", "--rolled-back", brokenName], broken.config);
  check("resolve marks it rolled back", resolved.status === 0, resolved.out.slice(-300));
  verdict = await checkSchema(prismaClientLike, broken.root);
  check("which makes it pending again", verdict !== "unknown" && !verdict.ok && verdict.kind === "behind" && verdict.pending.includes(brokenName), JSON.stringify(verdict));

  // The cause put right: the half-made table is dropped by hand and the migration is made to do what it meant to.
  await client.query(`DROP TABLE verify_half_done`);
  await writeFile(path.join(brokenDir, "migration.sql"), `CREATE TABLE "verify_half_done" ("id" INT);\n`);
  const again = prisma(["migrate", "deploy"], broken.config);
  check("applying again finishes it", again.status === 0, again.out.slice(-400));
  verdict = await checkSchema(prismaClientLike, broken.root);
  check("and the database is at the schema it was asked for", verdict !== "unknown" && verdict.ok, JSON.stringify(verdict));

} catch (error) {
  // Said, with the checks that did pass above it, rather than lost to the cleanup that follows.
  fail++;
  console.log(`  FAIL the run stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await client.end().catch(() => {});
  await dropDatabase().catch(() => {});
  await rm(work, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
