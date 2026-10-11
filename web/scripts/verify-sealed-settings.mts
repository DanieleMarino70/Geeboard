import "./load-env.mts";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";

/* A server's secret settings, sealed, on a database 0.10.1 left (0.11.0).

   A join password, Valheim's and Terraria's, was kept in the clear in the server's settings, and Valheim's again in the record of what its
   workload was made from. This lays a database at 0.10.1's schema — its migrations and no later one — puts servers in it with their
   passwords the way 0.10.1 wrote them, and applies this checkout's migrations. Then what the upgrade promises is checked: the poller's first
   start seals them, the game is still given the right password, the record of the workload no longer holds it, the boot check and `rekey`
   know the new column, and a wrong key is the same refusal as for every sealed column. And the two releases on either side: 0.10.1, rolled
   back to, changes a password in the clear copy and the next start seals the new one; the release after this one removes the clear copy and
   the game still gets the password, from the sealed copy alone.

   Never the database DATABASE_URL names — a sibling called <name>_sealed, made for the run and dropped after it. */

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");

/* The last migration 0.10.1 carried (test/migrations-pinned.json is written from its tag). */
const LAST_OF_0_10_1 = "20261009180000_panel_update_requests";

const sealedDb = `${new URL(base).pathname.replace(/^\//, "")}_sealed`;
const sealedUrl = new URL(base);
sealedUrl.pathname = `/${sealedDb}`;
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
const work = await mkdtemp(path.join(tmpdir(), "geeboard-sealed-"));
const configDir = path.join(WEB, ".verify-sealed");
await mkdir(configDir, { recursive: true });

async function lay(name: string, migrations: string[]): Promise<string> {
  const dir = path.join(work, name, "prisma", "migrations");
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
  return config;
}

function deploy(config: string) {
  const run = spawnSync(process.execPath, [prismaBin, "migrate", "deploy", "--config", config], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: sealedUrl.toString() },
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

async function admin(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}
const dropDatabase = async () => {
  await admin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [sealedDb]);
  await admin(`DROP DATABASE IF EXISTS "${sealedDb}"`);
};

/* A row, with every column that must have a value given one: the ones named win, the rest are filled by type (as verify-upgrade does). */
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
      row[column.column_name] = `${table}-${column.column_name}-${Math.random().toString(36).slice(2, 8)}`.slice(0, column.character_maximum_length ?? undefined);
    } else if (/int|numeric|double|real/.test(column.data_type)) row[column.column_name] = 1;
    else if (column.data_type === "boolean") row[column.column_name] = false;
    else if (/timestamp|date/.test(column.data_type)) row[column.column_name] = new Date();
    else if (column.data_type === "jsonb" || column.data_type === "json") row[column.column_name] = "{}";
    else throw new Error(`no filler for ${table}.${column.column_name} (${column.data_type})`);
  }
  const names = Object.keys(row);
  await client.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
}

const KEY = "sealed-settings-key-Qm7Lx2Vc9Bn4Kp6Jh8Gf3Ds5";
const NEW_KEY = "sealed-settings-new-Yt5Re3Wq1Pl9Ok7Ij2Uh4Yg6";
const SESSION = "sealed-settings-session-Vb6Nm8Kj2Hg4Fd1Sa3Pq5";

const client = new pg.Client({ connectionString: sealedUrl.toString() });
client.on("error", () => {});
const names = (await readdir(real, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const until = names.indexOf(LAST_OF_0_10_1);
let db: { $disconnect: () => Promise<void> } | null = null;

/** The whole of a server's row as text, the way somebody with psql would search it. */
const rowText = async (id: string) => (await client.query<{ t: string }>(`SELECT row_to_json(s)::text AS t FROM servers s WHERE id = $1`, [id])).rows[0]!.t;
const column = async <T,>(id: string, name: string) => (await client.query(`SELECT "${name}" AS v FROM servers WHERE id = $1`, [id])).rows[0]!.v as T;

try {
  console.log("\n== the schema 0.10.1 left, with servers that have join passwords ==");
  check("this checkout still has the migration 0.10.1 ended on, and this release's after it", until > 0 && names.length > until + 1, LAST_OF_0_10_1);
  await dropDatabase();
  await admin(`CREATE DATABASE "${sealedDb}"`);
  const old = deploy(await lay("old", names.slice(0, until + 1)));
  check(`the ${until + 1} migrations of 0.10.1 apply`, old.status === 0, old.out.slice(-400));

  await client.connect();
  await insertRow(client, "users", { id: "u_owner", email: "owner@sealed.test", role: "OWNER" });
  await insertRow(client, "nodes", { id: "n_one", name: "sealed-node" });
  await insertRow(client, "games", { id: "terraria", name: "Terraria", family: "Terraria" });
  await insertRow(client, "games", { id: "valheim", name: "Valheim", family: "Valheim" });
  // How 0.10.1 wrote them: the password in the settings, and Valheim's — an environment variable — in the record of its workload too.
  await insertRow(client, "servers", { id: "s_tera", slug: "tera", host: "tera.sealed.test", port: 7777, ownerId: "u_owner", nodeId: "n_one", gameId: "terraria", config: JSON.stringify({ password: "hunter2-terraria", maxPlayers: 8, motd: "hello" }) });
  const builtSpec = { source: "lloesche/valheim-server", env: { SERVER_NAME: "vh", SERVER_PASS: "hunter2-valheim", GEEBOARD_SERVER: "vh" }, args: [], dataPath: "/config", cachePaths: [], ports: [], memoryMb: 4096, cpuLimit: 200 };
  // On a version the definition knows, so that whether its workload is out of date can be asked.
  const { requireGame: definition } = await import("../src/domain/games/registry");
  const valheimVersion = definition("valheim").versions[0]!.label;
  await insertRow(client, "servers", { id: "s_vh", slug: "vh", host: "vh.sealed.test", port: 2456, ownerId: "u_owner", nodeId: "n_one", gameId: "valheim", version: valheimVersion, config: JSON.stringify({ password: "hunter2-valheim", worldName: "geeboard" }), builtSpec: JSON.stringify(builtSpec), runtimeId: "c-vh" });
  // A server without a password: nothing to seal.
  await insertRow(client, "servers", { id: "s_open", slug: "open", host: "open.sealed.test", port: 7779, ownerId: "u_owner", nodeId: "n_one", gameId: "terraria", config: JSON.stringify({ maxPlayers: 4 }) });
  check("the passwords are in the clear, as 0.10.1 kept them", (await rowText("s_tera")).includes("hunter2-terraria") && (await rowText("s_vh")).split("hunter2-valheim").length === 3);

  console.log("\n== this release's migration ==");
  const applied = deploy(await lay("full", names));
  check("it applies", applied.status === 0, applied.out.slice(-400));
  const added = await client.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'servers' AND column_name = 'secretSettings'`);
  check("it adds one column, text, that may be null — an addition, which 0.10.1's code does not see", added.rows.length === 1 && added.rows[0].data_type === "text" && added.rows[0].is_nullable === "YES", JSON.stringify(added.rows));
  check("and moves nothing: the settings are as they were until the key is at hand", (await rowText("s_tera")).includes("hunter2-terraria") && (await column<string | null>("s_tera", "secretSettings")) === null);

  // The panel's code, against this database and this key, from here on.
  process.env.DATABASE_URL = sealedUrl.toString();
  process.env.SECRETS_KEY = KEY;
  const lib = await import("../src/lib/db");
  db = lib.db;
  const { sealServerSettings, storedSettings } = await import("../src/lib/server-secrets");
  const { checkSealedSecrets } = await import("../src/lib/sealed-check");
  const { describeSealed } = await import("../src/domain/sealed");
  const { rekeyOp } = await import("../src/lib/rekey-ops");
  const { rebuildNeededFor } = await import("../src/lib/update-ops");
  const { asPlatformError } = await import("../src/domain/errors");
  const { currentConfig, renderConfig } = await import("../src/domain/games/config");
  const { requireGame } = await import("../src/domain/games/registry");
  const terraria = requireGame("terraria");
  const valheim = requireGame("valheim");

  const server = (id: string) => lib.db.server.findUniqueOrThrow({ where: { id } });
  const terrariaFile = async (id: string) => {
    const rendered = renderConfig(terraria, currentConfig(terraria, { config: storedSettings(await server(id)) }), undefined, { includeEmpty: true });
    return rendered.files.find((f) => f.path === "serverconfig.txt")?.entries.find((e) => e.key === "password")?.value;
  };
  const valheimEnv = async (id: string) => renderConfig(valheim, currentConfig(valheim, { config: storedSettings(await server(id)) }), undefined, { includeEmpty: true }).env.SERVER_PASS;

  console.log("\n== the poller's first start seals them ==");
  const first = await sealServerSettings();
  check("two servers' settings sealed, and one workload record cleaned", first.sealed === 2 && first.specs === 1 && first.unreadable === 0, JSON.stringify(first));
  const teraSealed = await column<string>("s_tera", "secretSettings");
  check("the sealed column holds no password, and nothing else of the settings", teraSealed !== null && !teraSealed.includes("hunter2") && !teraSealed.includes("hello") && teraSealed.startsWith("v1."), teraSealed);
  check("a server with no password has nothing sealed", (await column<string | null>("s_open", "secretSettings")) === null);
  const spec = await column<{ env: Record<string, string> }>("s_vh", "builtSpec");
  check("the record of Valheim's workload no longer holds its password, and keeps the rest", !JSON.stringify(spec).includes("hunter2") && spec.env.SERVER_NAME === "vh" && !("SERVER_PASS" in spec.env), JSON.stringify(spec));
  const differences = rebuildNeededFor({ ...(await server("s_vh")), gameVersionRef: null });
  check("and the password is not a reason to call the workload out of date", differences !== null && !differences.join(" ").includes("SERVER_PASS"), JSON.stringify(differences));
  check("the clear copy is still in the settings, for 0.10.1: it goes in the release after this one", (await column<{ password: string }>("s_tera", "config")).password === "hunter2-terraria");
  const again = await sealServerSettings();
  check("a second start finds nothing to do", again.sealed === 0 && again.specs === 0, JSON.stringify(again));

  console.log("\n== the game is given the right password ==");
  check("Terraria's serverconfig.txt gets it", (await terrariaFile("s_tera")) === "hunter2-terraria");
  check("Valheim's environment gets it", (await valheimEnv("s_vh")) === "hunter2-valheim");

  console.log("\n== the boot check knows the column ==");
  let report = await checkSealedSecrets();
  check("both open with the key", report.unreadable.length === 0 && report.opened >= 2, JSON.stringify(report));

  console.log("\n== rolled back to 0.10.1, which changes a password in the clear copy ==");
  await client.query(`UPDATE servers SET config = jsonb_set(config, '{password}', '"swordfish-terraria"') WHERE id = 's_tera'`);
  check("while the clear copy is there it is what the game gets", (await terrariaFile("s_tera")) === "swordfish-terraria");
  const back = await sealServerSettings();
  check("and back on this release, the next start seals the new one", back.sealed === 1 && (await storedSettings({ config: {}, secretSettings: await column<string>("s_tera", "secretSettings") })).password === "swordfish-terraria", JSON.stringify(back));

  console.log("\n== the release after this one removes the clear copy ==");
  await client.query(`UPDATE servers SET config = config - 'password' WHERE id IN ('s_tera', 's_vh')`);
  check("no password is anywhere in either server's row", !(await rowText("s_tera")).includes("swordfish") && !(await rowText("s_vh")).includes("hunter2"), await rowText("s_vh"));
  check("and the game still gets Terraria's, from the sealed copy alone", (await terrariaFile("s_tera")) === "swordfish-terraria");
  check("and Valheim's", (await valheimEnv("s_vh")) === "hunter2-valheim");
  check("and the poller has nothing to seal again", (await sealServerSettings()).sealed === 0);

  console.log("\n== a key that is not the one they were sealed with ==");
  const teraBefore = await column<string>("s_tera", "secretSettings");
  process.env.SECRETS_KEY = "sealed-settings-wrong-Zz9Yx8Ww7Vv6Uu5Tt4Ss3";
  report = await checkSealedSecrets();
  const line = describeSealed(report);
  check("the boot check counts them, under their own name", report.unreadable.some((u) => u.what === "servers' secret settings" && u.count === 2), JSON.stringify(report));
  check("in the one line it says for every sealed column", line !== null && /servers' secret settings: 2/.test(line), String(line));
  let refusal = "";
  try {
    await terrariaFile("s_tera");
  } catch (error) {
    refusal = asPlatformError(error).code;
  }
  check("rendering the settings is refused as SECRETS_UNREADABLE, like a node's token", refusal === "SECRETS_UNREADABLE", refusal);
  check("and the start-up sealing writes nothing over them with this key", (await sealServerSettings()).sealed === 0 && (await column<string>("s_tera", "secretSettings")) === teraBefore);
  process.env.SECRETS_KEY = KEY;

  console.log("\n== rekey ==");
  const rekeyed = await rekeyOp({ currentKey: KEY, newKey: NEW_KEY, sessionSecret: SESSION });
  check("it seals them again, and counts them", rekeyed.ok && rekeyed.counts.find((c) => c.kind === "servers' secret settings")?.values === 2, JSON.stringify(rekeyed));
  process.env.SECRETS_KEY = NEW_KEY;
  check("under the new key the game gets the same passwords", (await terrariaFile("s_tera")) === "swordfish-terraria" && (await valheimEnv("s_vh")) === "hunter2-valheim");
  report = await checkSealedSecrets();
  check("and the boot check is quiet", report.unreadable.length === 0, JSON.stringify(report));
} catch (error) {
  fail++;
  console.log(`  FAIL the run stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await db?.$disconnect().catch(() => {});
  await client.end().catch(() => {});
  await dropDatabase().catch(() => {});
  await rm(work, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
