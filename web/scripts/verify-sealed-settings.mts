import "./load-env.mts";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";

/* A server's secret settings: sealed by 0.11.0 beside a clear copy, and from 0.12.0 sealed alone.

   A join password, Valheim's and Terraria's, was kept in the clear in the server's settings, and Valheim's again in the record of what its
   workload was made from. This lays a database at 0.10.1's schema — its migrations and no later one — puts servers in it with their
   passwords the way 0.10.1 wrote them, applies this checkout's migrations, and starts the release before this one's poller on it, from
   that release's own code: the database 0.11 leaves, every password sealed and still in the clear beside it. Then what the upgrade
   promises is checked: this release's first start removes the clear copies, and seals what nothing had sealed; no password is left in the
   clear anywhere in a server's row; the game is still given the right one, from the sealed copy alone; a save writes none. Then the
   release before, rolled back to, on that database (its code again): the game still gets the password on a rebuild, its Settings page
   draws the password as set, a save of another field from that page keeps it, and a key this release made works there; and back on this
   release, the clear copy that save wrote is removed at the next start. And the boot check, a wrong key and `rekey`, as for every sealed
   column.

   Never the database DATABASE_URL names — a sibling called <name>_sealed, made for the run and dropped after it. */

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");

/* The last migration 0.10.1 carried (test/migrations-pinned.json is written from its tag). */
const LAST_OF_0_10_1 = "20261009180000_panel_update_requests";

/* The release a rollback goes to, whose code is run against the database this one has cleaned: from 0.12.0 that is 0.11.1, whose Settings
   page reads the sealed copy (docs/upgrading.md, "To 0.12.0: the clear copy is gone"), named by the commit that changed that page.
   0.11.0's reads the clear copy alone, and with it gone draws a password as unset and a save from that page clears it:
   GEEBOARD_VERIFY_PREVIOUS=v0.11.0 runs this against it, and the rollback checks fail, which is what that paragraph says. A checkout that
   does not have the commit (CI's is shallow) fetches it. */
const PREVIOUS = process.env.GEEBOARD_VERIFY_PREVIOUS || "85dd4f85cb96907907f15a2851ddd97a0cf89334";

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

const git = (args: string[], input?: Buffer) => {
  // From the repository's root, which the paths below are named from.
  const run = spawnSync("git", args, { cwd: path.dirname(WEB), input, maxBuffer: 256 * 1024 * 1024 });
  return { status: run.status, out: run.stdout ?? Buffer.alloc(0), err: run.stderr?.toString() ?? "" };
};

/* The web/ of a release, as its tag has it, under `into`: its source and its tsconfig, read from git one blob after another through one
   `cat-file`, with this checkout's packages beside it (the release before this one has the same ones, and the same schema). */
async function checkoutOf(ref: string, into: string): Promise<string> {
  let commit = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (commit.status !== 0) {
    // Not fetched shallow into a whole clone, where it would cut the history of every other branch at it.
    const shallow = git(["rev-parse", "--is-shallow-repository"]).out.toString().trim() === "true";
    const fetched = git(["fetch", "--quiet", ...(shallow ? ["--depth=1"] : []), "origin", ref]);
    if (fetched.status !== 0) throw new Error(`${ref} is not in this checkout and could not be fetched: ${fetched.err.trim()}`);
    commit = git(["rev-parse", "--verify", "--quiet", "FETCH_HEAD^{commit}"]);
  }
  const sha = commit.out.toString().trim();
  const blobs = git(["ls-tree", "-r", "-z", sha, "--", "web/src", "web/tsconfig.json"])
    .out.toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t") as [string, string];
      const [, type, blob] = meta.split(" ");
      return { type, blob: blob!, file };
    })
    .filter((entry) => entry.type === "blob");
  const batch = git(["cat-file", "--batch"], Buffer.from(blobs.map((b) => b.blob).join("\n") + "\n")).out;
  let at = 0;
  for (const { file } of blobs) {
    const header = batch.indexOf(10, at);
    const size = Number(batch.subarray(at, header).toString().split(" ")[2]);
    const out = path.join(into, file);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, batch.subarray(header + 1, header + 1 + size));
    at = header + 1 + size + 1;
  }
  await symlink(path.join(WEB, "node_modules"), path.join(into, "web", "node_modules"), "junction");
  await mkdir(path.join(into, "web", "scripts"), { recursive: true });
  await cp(path.join(WEB, "scripts", "verify-sealed-settings-previous.mts"), path.join(into, "web", "scripts", "verify-sealed-settings-previous.mts"));
  return sha;
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
/** Every server's row as text, the table the way a dump of it has it. */
const tableText = async () => (await client.query<{ t: string }>(`SELECT coalesce(json_agg(s), '[]')::text AS t FROM servers s`)).rows[0]!.t;
const PASSWORDS = ["hunter2-terraria", "hunter2-valheim", "hunter2-late", "swordfish-late"];
const inClear = async () => {
  const table = await tableText();
  return PASSWORDS.filter((p) => table.includes(p));
};

/* The release before this one, run from its own web/ (checkoutOf) by verify-sealed-settings-previous.mts, which prints one line. */
let previousWeb = "";
const previous = (phase: string, env: Record<string, string> = {}) => {
  const run = spawnSync(
    process.execPath,
    [
      path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs"),
      "--tsconfig",
      path.join(previousWeb, "tsconfig.json"),
      "--conditions=react-server",
      path.join(previousWeb, "scripts", "verify-sealed-settings-previous.mts"),
      phase,
    ],
    { cwd: previousWeb, env: { ...process.env, DATABASE_URL: sealedUrl.toString(), SECRETS_KEY: KEY, ...env }, encoding: "utf8", timeout: 180_000 },
  );
  try {
    return JSON.parse(run.stdout?.trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
  } catch {
    throw new Error(`the release before this one did not answer (${phase}): ${`${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim().slice(-1500)}`);
  }
};

try {
  console.log("\n== the schema 0.10.1 left, with servers that have join passwords ==");
  check("this checkout still has the migration 0.10.1 ended on, and later ones after it", until > 0 && names.length > until + 1, LAST_OF_0_10_1);
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
  await insertRow(client, "servers", { id: "s_vh", slug: "vh", host: "vh.sealed.test", port: 2456, ownerId: "u_owner", nodeId: "n_one", gameId: "valheim", version: valheimVersion, config: JSON.stringify({ password: "hunter2-valheim", worldName: "geeboard", serverName: "Ashfold" }), builtSpec: JSON.stringify(builtSpec), runtimeId: "c-vh" });
  // A server without a password: nothing to seal.
  await insertRow(client, "servers", { id: "s_open", slug: "open", host: "open.sealed.test", port: 7779, ownerId: "u_owner", nodeId: "n_one", gameId: "terraria", config: JSON.stringify({ maxPlayers: 4 }) });
  check("the passwords are in the clear, as 0.10.1 kept them", (await rowText("s_tera")).includes("hunter2-terraria") && (await rowText("s_vh")).split("hunter2-valheim").length === 3);

  console.log("\n== this checkout's migrations ==");
  const applied = deploy(await lay("full", names));
  check("they apply", applied.status === 0, applied.out.slice(-400));
  const added = await client.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'servers' AND column_name = 'secretSettings'`);
  check("0.11.0's adds one column, text, that may be null — an addition, which 0.10.1's code does not see", added.rows.length === 1 && added.rows[0].data_type === "text" && added.rows[0].is_nullable === "YES", JSON.stringify(added.rows));
  check("and none of them moves a password: that waits for the key", (await rowText("s_tera")).includes("hunter2-terraria") && (await column<string | null>("s_tera", "secretSettings")) === null);

  console.log(`\n== the release before this one, ${PREVIOUS}, starts on it ==`);
  const sha = await checkoutOf(PREVIOUS, path.join(work, "previous"));
  previousWeb = path.join(work, "previous", "web");
  check(`its code is ${PREVIOUS}'s (${sha.slice(0, 12)}), run from its own source`, /^[0-9a-f]{40}$/.test(sha), sha);
  const byPrevious = previous("seal");
  check("its poller seals both passwords, and takes Valheim's out of the record of its workload", byPrevious.sealed === 2 && byPrevious.specs === 1, JSON.stringify(byPrevious));
  check(
    "and keeps the clear copy beside them: the database 0.11 leaves",
    (await column<{ password?: string }>("s_tera", "config")).password === "hunter2-terraria" && (await column<string | null>("s_tera", "secretSettings"))?.startsWith("v1.") === true,
  );
  // A server whose password nothing has sealed, written as 0.10.1 writes it.
  await insertRow(client, "servers", { id: "s_late", slug: "late", host: "late.sealed.test", port: 7781, ownerId: "u_owner", nodeId: "n_one", gameId: "terraria", config: JSON.stringify({ password: "hunter2-late", maxPlayers: 6 }) });

  // This release's code, against this database and this key, from here on.
  process.env.DATABASE_URL = sealedUrl.toString();
  process.env.SECRETS_KEY = KEY;
  const lib = await import("../src/lib/db");
  db = lib.db;
  const { commandForAudit, sealServerSettings, storedSettings } = await import("../src/lib/server-secrets");
  const { updateServerConfigOp } = await import("../src/lib/config-ops");
  const { createApiKeyOp } = await import("../src/lib/server-ops");
  const { checkSealedSecrets } = await import("../src/lib/sealed-check");
  const { describeSealed } = await import("../src/domain/sealed");
  const { rekeyOp } = await import("../src/lib/rekey-ops");
  const { rebuildNeededFor } = await import("../src/lib/update-ops");
  const { asPlatformError } = await import("../src/domain/errors");
  const { currentConfig, renderConfig, SECRET_MASK } = await import("../src/domain/games/config");
  const { requireGame } = await import("../src/domain/games/registry");
  const terraria = requireGame("terraria");
  const valheim = requireGame("valheim");

  const server = (id: string) => lib.db.server.findUniqueOrThrow({ where: { id } });
  const terrariaFile = async (id: string) => {
    const rendered = renderConfig(terraria, currentConfig(terraria, { config: storedSettings(await server(id)) }), undefined, { includeEmpty: true });
    return rendered.files.find((f) => f.path === "serverconfig.txt")?.entries.find((e) => e.key === "password")?.value;
  };
  const valheimEnv = async (id: string) => renderConfig(valheim, currentConfig(valheim, { config: storedSettings(await server(id)) }), undefined, { includeEmpty: true }).env.SERVER_PASS;

  console.log("\n== this release's first start takes the clear copies out ==");
  const first = await sealServerSettings();
  check("three servers' clear copies removed, and the one nothing had sealed sealed", first.cleared === 3 && first.sealed === 1 && first.specs === 0 && first.unreadable === 0, JSON.stringify(first));
  check("no join password is left in the clear in any server's row", (await inClear()).length === 0, (await inClear()).join(", "));
  const teraSealed = await column<string>("s_tera", "secretSettings");
  check("the sealed column holds no password, and nothing else of the settings", teraSealed.startsWith("v1.") && !teraSealed.includes("hunter2") && !teraSealed.includes("hello"), teraSealed);
  check("and the other settings are as they were", JSON.stringify(await column("s_tera", "config")) === JSON.stringify({ motd: "hello", maxPlayers: 8 }), JSON.stringify(await column("s_tera", "config")));
  check("a server with no password has nothing sealed and nothing taken out", (await column<string | null>("s_open", "secretSettings")) === null && JSON.stringify(await column("s_open", "config")) === JSON.stringify({ maxPlayers: 4 }));
  const differences = rebuildNeededFor({ ...(await server("s_vh")), gameVersionRef: null });
  check("the password is not a reason to call Valheim's workload out of date", differences !== null && !differences.join(" ").includes("SERVER_PASS"), JSON.stringify(differences));
  const again = await sealServerSettings();
  check("a second start finds nothing to do", again.sealed === 0 && again.cleared === 0 && again.specs === 0, JSON.stringify(again));

  console.log("\n== the game is given the right password, from the sealed copy alone ==");
  check("Terraria's serverconfig.txt gets it", (await terrariaFile("s_tera")) === "hunter2-terraria");
  check("Valheim's environment gets it", (await valheimEnv("s_vh")) === "hunter2-valheim");
  check("and the server nothing had sealed gets its own", (await terrariaFile("s_late")) === "hunter2-late");

  console.log("\n== a save on this release writes no clear copy ==");
  const owner = await lib.db.user.findUniqueOrThrow({ where: { id: "u_owner" } });
  let saved = await updateServerConfigOp(owner, "tera", { motd: "saved here" });
  const tera = await server("s_tera");
  check("another setting is saved, the password is still not in the settings, and it is the same one", saved.ok && !("password" in (tera.config as object)) && storedSettings(tera).password === "hunter2-terraria", JSON.stringify([saved, tera.config]));
  saved = await updateServerConfigOp(owner, "late", { password: "swordfish-late" });
  check("a new password is sealed, and written nowhere in the clear", saved.ok && (await inClear()).length === 0 && storedSettings(await server("s_late")).password === "swordfish-late", JSON.stringify(saved));

  console.log(`\n== rolled back to ${PREVIOUS}, on the database this release cleaned ==`);
  const minted = await createApiKeyOp(owner, "Monitor", ["servers:monitor"]);
  const monitor = await lib.db.apiKey.findFirstOrThrow({ where: { name: "Monitor" } });
  check("a key made here with servers:monitor stores that name alone", minted.ok && monitor.scopes.join() === "servers:monitor", JSON.stringify(monitor.scopes));
  const back = previous("rollback", { SEALED_OWNER: owner.id, SEALED_MONITOR_KEY: (minted as { secret?: string }).secret ?? "" });
  check("(a) a rebuild there gives Terraria its password, from the sealed copy", back.terrariaFile === "hunter2-terraria", JSON.stringify(back));
  check("(a) and Valheim its", back.valheimEnv === "hunter2-valheim", String(back.valheimEnv));
  check("(b) its Settings page draws Terraria's password as set, with no file of the server's to read it from", back.teraForm === SECRET_MASK, JSON.stringify(back.teraForm));
  check("(b) and Valheim's, a start-up variable, which no file holds", back.vhForm === SECRET_MASK, JSON.stringify(back.vhForm));
  const keptTera = await server("s_tera");
  check("(c) a save of another field from that page is written", (back.teraSave as { ok?: boolean }).ok === true && (keptTera.config as { motd?: string }).motd === "saved by the release before", JSON.stringify(back.teraSave));
  check("(c) and keeps Terraria's password", storedSettings(keptTera).password === "hunter2-terraria", JSON.stringify(storedSettings(keptTera).password));
  check("(c) and the same save of Valheim's would change its name and nothing else", JSON.stringify(back.vhChanges) === JSON.stringify(["serverName"]), JSON.stringify(back.vhChanges));
  check("and the key with servers:monitor alone reads a server's numbers there", back.monitorKey === 200, String(back.monitorKey));

  console.log("\n== and back on this release ==");
  const returned = await sealServerSettings();
  check("the next start takes out the clear copy that release's save wrote, and has nothing to seal", returned.cleared === 1 && returned.sealed === 0, JSON.stringify(returned));
  check("and no join password is in the clear again", (await inClear()).length === 0, (await inClear()).join(", "));

  console.log("\n== the boot check knows the column ==");
  let report = await checkSealedSecrets();
  check("the three open with the key", report.unreadable.length === 0 && report.opened >= 3, JSON.stringify(report));

  console.log("\n== a key that is not the one they were sealed with ==");
  // And a clear copy beside one of them, as a panel rolled back to 0.11 writes it.
  await client.query(`UPDATE servers SET config = jsonb_set(config, '{password}', '"hunter2-terraria"') WHERE id = 's_tera'`);
  const teraBefore = await column<string>("s_tera", "secretSettings");
  process.env.SECRETS_KEY = "sealed-settings-wrong-Zz9Yx8Ww7Vv6Uu5Tt4Ss3";
  report = await checkSealedSecrets();
  const line = describeSealed(report);
  check("the boot check counts them, under their own name", report.unreadable.some((u) => u.what === "servers' secret settings" && u.count === 3), JSON.stringify(report));
  check("in the one line it says for every sealed column", line !== null && /servers' secret settings: 3/.test(line), String(line));
  let refusal = "";
  try {
    await valheimEnv("s_vh");
  } catch (error) {
    refusal = asPlatformError(error).code;
  }
  check("rendering the settings is refused as SECRETS_UNREADABLE, like a node's token", refusal === "SECRETS_UNREADABLE", refusal);
  const unread = await sealServerSettings();
  check(
    "the start-up pass writes nothing with this key: the sealed value stays, and the clear copy, the one that can still be read",
    unread.unreadable === 1 && unread.sealed === 0 && unread.cleared === 0 && (await column<string>("s_tera", "secretSettings")) === teraBefore && (await rowText("s_tera")).includes("hunter2-terraria"),
    JSON.stringify(unread),
  );
  check(
    "a typed command's audit line keeps the command and not what followed it, since what to take out of it cannot be read",
    commandForAudit(valheim, await server("s_vh"), "password hunter2-valheim") === "password [hidden]" && commandForAudit(valheim, await server("s_vh"), "save") === "save",
  );
  process.env.SECRETS_KEY = KEY;
  check("with the key back, the next start takes that clear copy out", (await sealServerSettings()).cleared === 1 && (await inClear()).length === 0);

  console.log("\n== rekey ==");
  const rekeyed = await rekeyOp({ currentKey: KEY, newKey: NEW_KEY, sessionSecret: SESSION });
  check("it seals them again, and counts them", rekeyed.ok && rekeyed.counts.find((c) => c.kind === "servers' secret settings")?.values === 3, JSON.stringify(rekeyed));
  process.env.SECRETS_KEY = NEW_KEY;
  check("under the new key the game gets the same passwords", (await terrariaFile("s_tera")) === "hunter2-terraria" && (await valheimEnv("s_vh")) === "hunter2-valheim" && (await terrariaFile("s_late")) === "swordfish-late");
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
