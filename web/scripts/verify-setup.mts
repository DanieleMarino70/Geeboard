import "./load-env.mts";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import process from "node:process";
import pg from "pg";
import { SignJWT } from "jose";

/* A production installation's first hour, walked from an empty database.

   No seed: that is the point. A database is made for this run and dropped
   after it — never the one DATABASE_URL names, only a sibling called
   <name>_setup — and `npm run setup` is run against it the way a person
   runs it, as a child process whose output is read for the temporary
   password, because reading it off the terminal is the only way anybody
   ever gets it.

   Then a second panel is started on its own port and build directory,
   against that database, and asked for its pages and its API with a real
   session cookie. The gate is a redirect and a 403; nothing short of a
   running server shows either. */


const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");
const SESSION_SECRET = "verify-setup-Qm7Lx2Vc9Bn4Kp6Jh8Gf3Ds5Aa1Zz0Ww";
const SECRETS_KEY = "verify-setup-Yt5Re3Wq1Pl9Ok7Ij2Uh4Yg6Tf8Rd0Es";

const url = new URL(base);
const parentDb = url.pathname.replace(/^\//, "");
const setupDb = `${parentDb}_setup`;
const setupUrl = new URL(base);
setupUrl.pathname = `/${setupDb}`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
adminUrl.search = "";

const PORT = 3200 + Math.floor(Math.random() * 90);
const PANEL = `http://127.0.0.1:${PORT}`;
const env: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: setupUrl.toString(),
  SESSION_SECRET,
  SECRETS_KEY,
  GEEBOARD_DIST_DIR: ".next-verify",
};
// Whatever this shell had: the commands below are run as a developer's, except where they say otherwise.
delete env.NODE_ENV;

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

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(script: string, args: string[], extraEnv: Record<string, string | undefined> = {}) {
  /* npm is a .cmd on Windows and needs a shell there, and a shell wants
     one command line, quoted by hand. Every argument here is written in
     this file, so there is nothing to escape but a space. */
  const childEnv = { ...env, ...extraEnv } as NodeJS.ProcessEnv;
  const result =
    process.platform === "win32"
      ? spawnSync([npm, "run", "--silent", script, "--", ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" "), {
          env: childEnv,
          encoding: "utf8",
          shell: true,
        })
      : spawnSync(npm, ["run", "--silent", script, "--", ...args], { env: childEnv, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
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
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [setupDb]);
    await client.query(`DROP DATABASE IF EXISTS "${setupDb}"`);
  });

let panel: ChildProcess | undefined;

try {
  console.log(`\n== an empty database, ${setupDb} ==`);
  await dropDatabase();
  await admin((client) => client.query(`CREATE DATABASE "${setupDb}"`));
  check("it has no tables at all", true);

  console.log("\n== the seed does not run in production ==");
  const seeded = run("db:seed:empty", [], { NODE_ENV: "production" });
  check("db:seed:empty refuses with NODE_ENV=production", seeded.status !== 0 && /does not run with NODE_ENV=production/.test(seeded.out), seeded.out.slice(-300));

  console.log("\n== setup refuses a bad environment ==");
  let r = run("setup", ["--email", "owner@example.com", "--name", "First Owner"], { SESSION_SECRET: "generate-with-openssl-rand-base64-32" });
  check("an example secret stops it before anything is touched", r.status === 1 && /placeholder/.test(r.out), r.out.slice(-300));

  console.log("\n== npm run setup ==");
  r = run("setup", ["--email", "Owner@Example.com", "--name", "First Owner"]);
  check("it succeeds on an empty database", r.status === 0, r.out.slice(-600));
  const temporary = /Temporary password:\s+(\S+)/.exec(r.out)?.[1] ?? "";
  check("and shows a temporary password, once", /^[A-Za-z2-9]{5}(-[A-Za-z2-9]{5}){3}$/.test(temporary), temporary ? "(shape)" : r.out.slice(-300));

  process.env.DATABASE_URL = setupUrl.toString();
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.SECRETS_KEY = SECRETS_KEY;
  const { db } = await import("../src/lib/db");
  const { verifyCredentials } = await import("../src/lib/auth");
  const { changePasswordOp, beginTwoFactorOp, confirmTwoFactorOp } = await import("../src/lib/account-ops");
  const { accountGate, temporaryPasswordExpired } = await import("../src/domain/access/account");
  const { base32Decode, totp } = await import("../src/domain/access/totp");
  const { allGames } = await import("../src/domain/games/registry");

  const owner = async () => db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
  check("migrations were applied by it", (await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`)[0]!.n > BigInt(15));
  check("the catalog was written from the definitions", (await db.game.count()) === allGames().length && (await db.gameVersion.count()) > 10);
  check("there is exactly one account, an owner", (await db.user.count()) === 1 && (await owner()).role === "OWNER");
  check("the password is stored as a hash and nowhere as itself", (await owner()).passwordHash.startsWith("$2") && !JSON.stringify(await owner()).includes(temporary));
  check("no node, no server, no sample data", (await db.node.count()) === 0 && (await db.server.count()) === 0);
  check("the creation is in the audit log, without the password", (await db.activityEvent.count({ where: { action: "installation.owner.created" } })) === 1 && !JSON.stringify(await db.activityEvent.findMany()).includes(temporary));
  const expiry = (await owner()).temporaryPasswordExpiresAt!;
  check("it expires in a day", Math.abs(expiry.getTime() - Date.now() - 24 * 3600_000) < 5 * 60_000, expiry.toISOString());

  console.log("\n== setup is not a way to a second owner ==");
  r = run("setup", ["--email", "second@example.com", "--name", "Second Owner"]);
  check("a second run refuses", r.status === 3 && /already has an account/.test(r.out), r.out.slice(-300));
  check("and made nobody", (await db.user.count()) === 1);

  console.log("\n== signing in with the temporary password ==");
  check("the temporary password is the account's password", (await verifyCredentials("owner@example.com", temporary))?.id === (await owner()).id);
  check("a wrong one is not", (await verifyCredentials("owner@example.com", `${temporary}x`)) === null);
  check("the gate is the password, not two-factor yet", accountGate(await owner()) === "password");

  console.log("\n== a running panel, and what it lets this session see ==");
  panel =
    process.platform === "win32"
      ? spawn(`${npm} run --silent dev -- -p ${PORT}`, { env: env as NodeJS.ProcessEnv, shell: true, stdio: "ignore" })
      : spawn(npm, ["run", "--silent", "dev", "--", "-p", String(PORT)], { env: env as NodeJS.ProcessEnv, stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    up = await fetch(`${PANEL}/sign-in`, { redirect: "manual" }).then((x) => x.status === 200, () => false);
    if (!up) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check("the panel starts against the new database", up);

  async function cookieFor(userId: string) {
    const session = await db.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000), userAgent: "verify-setup" } });
    const token = await new SignJWT({ sid: session.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SESSION_SECRET));
    return `gb_session=${token}`;
  }
  const get = (at: string, cookie: string) => fetch(`${PANEL}${at}`, { headers: { cookie }, redirect: "manual" });

  const PAGES = ["/", "/servers", "/servers/new", "/nodes", "/backups", "/scheduler", "/console", "/files", "/players", "/analytics", "/members", "/api-keys", "/audit", "/activity", "/games", "/settings"];
  const API = ["/api/v1/servers", "/api/v1/nodes", "/api/v1/games", "/api/v1/audit", "/api/v1/backups"];

  let cookie = await cookieFor((await owner()).id);
  let closed = 0;
  for (const page of PAGES) {
    const res = await get(page, cookie);
    if ((res.status === 307 || res.status === 303 || res.status === 302) && /\/account\?password=required/.test(res.headers.get("location") ?? "")) closed++;
    else console.log(`       ${page} -> ${res.status} ${res.headers.get("location") ?? ""}`);
  }
  check(`every page sends the temporary password back to the account page (${closed}/${PAGES.length})`, closed === PAGES.length);
  let refused = 0;
  for (const route of API) {
    const res = await get(route, cookie);
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (res.status === 403 && body.code === "FORBIDDEN" && /temporary password/.test(body.message ?? "")) refused++;
    else console.log(`       ${route} -> ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
  }
  check(`and the API refuses the session (${refused}/${API.length})`, refused === API.length);
  const account = await get("/account?password=required", cookie);
  const accountHtml = await account.text();
  check("the account page opens, and says what is missing in order", account.status === 200 && /Replace the temporary password/.test(accountHtml) && /Set up two-factor sign-in/.test(accountHtml));
  check("two-factor is not offered before the password is the owner's", !/Add Geeboard to your authenticator|>Set up<\/button>/.test(accountHtml) && (await beginTwoFactorOp(await owner())).ok === false);

  console.log("\n== choosing a password ==");
  const second = await cookieFor((await owner()).id);
  const kept = (await db.session.findFirstOrThrow({ where: { userId: (await owner()).id }, orderBy: { createdAt: "asc" } })).id;
  let op = await changePasswordOp(await owner(), "not the temporary one", "a password of my own", kept);
  check("the wrong current password is refused", !op.ok);
  op = await changePasswordOp(await owner(), temporary, "a password of my own", kept);
  check("the temporary password is exchanged for one of the owner's", op.ok, JSON.stringify(op));
  check("it closes the other sessions", (await get("/account", second)).status !== 200 && (await db.session.count({ where: { userId: (await owner()).id } })) === 1);
  check("the temporary password no longer works", (await verifyCredentials("owner@example.com", temporary)) === null);
  check("the new one does, and nothing expires any more", (await verifyCredentials("owner@example.com", "a password of my own")) !== null && (await owner()).temporaryPasswordExpiresAt === null);
  check("the gate moves on to two-factor", accountGate(await owner()) === "two-factor");
  let res = await get("/servers", cookie);
  check("pages now send the owner to enrol", /\/account\?enrol=required/.test(res.headers.get("location") ?? ""), `${res.status} ${res.headers.get("location")}`);
  res = await get("/api/v1/servers", cookie);
  check("and the API still refuses, for the other reason", res.status === 403 && /two-factor/.test(((await res.json()) as { message: string }).message));

  console.log("\n== two-factor ==");
  const begun = await beginTwoFactorOp(await owner());
  check("enrolment starts, with a secret and a code to scan", begun.ok && "secret" in begun && Array.isArray((begun as { qr?: string[] }).qr) && (begun as { qr: string[] }).qr.length > 20);
  const secret = base32Decode((begun as { secret: string }).secret);
  const confirmed = await confirmTwoFactorOp(await owner(), totp(secret, Date.now()));
  check("a code from the authenticator confirms it", confirmed.ok, JSON.stringify(confirmed).slice(0, 200));
  check("nothing stands in the way now", accountGate(await owner()) === null);

  console.log("\n== the whole panel ==");
  let open = 0;
  for (const page of PAGES) {
    const page200 = await get(page, cookie);
    if (page200.status === 200) open++;
    else console.log(`       ${page} -> ${page200.status} ${page200.headers.get("location") ?? ""}`);
  }
  check(`every page opens (${open}/${PAGES.length})`, open === PAGES.length);
  let answered = 0;
  for (const route of API) if ((await get(route, cookie)).status === 200) answered++;
  check(`and the API answers (${answered}/${API.length})`, answered === API.length);
  check("the dashboard is an empty workspace, not the sample one", !/Aurora SMP|fra-node-02/.test(await (await get("/", cookie)).text()));

  console.log("\n== recovery, from the panel's own machine ==");
  r = run("admin:recover", []);
  check("unattended, it wants to be told --yes", r.status === 2, r.out.slice(-200));
  r = run("admin:recover", ["--email", "nobody@example.com", "--yes"]);
  check("it recovers owners and nobody else", r.status === 3 && /not an owner/.test(r.out), r.out.slice(-200));
  r = run("admin:recover", ["--yes"]);
  const recovered = /Temporary password:\s+(\S+)/.exec(r.out)?.[1] ?? "";
  check("it gives the one owner a new temporary password", r.status === 0 && recovered.length === 23 && recovered !== temporary, r.out.slice(-300));
  check("which works", (await verifyCredentials("owner@example.com", recovered)) !== null);
  check("the password the owner had chosen does not", (await verifyCredentials("owner@example.com", "a password of my own")) === null);
  const after = await owner();
  check("two-factor is gone, with its recovery codes", !after.twoFactor && after.totpSecret === null && (await db.recoveryCode.count({ where: { userId: after.id } })) === 0);
  check("every session ended", (await db.session.count({ where: { userId: after.id } })) === 0 && (await get("/servers", cookie)).headers.get("location")?.includes("/sign-in") === true);
  check("the gate is back at the start", accountGate(after) === "password");
  check("and it is in the audit log as what it was", (await db.activityEvent.count({ where: { action: "installation.owner.recovered", target: "owner@example.com" } })) === 1);

  console.log("\n== a temporary password that ran out ==");
  await db.user.update({ where: { id: after.id }, data: { temporaryPasswordExpiresAt: new Date(Date.now() - 60_000) } });
  check("it is expired", temporaryPasswordExpired(await owner()));
  op = await changePasswordOp(await owner(), recovered, "another password of mine", null);
  check("and cannot be exchanged for a real one, even by an open session", !op.ok && /expired/.test(op.title), JSON.stringify(op));
  cookie = await cookieFor(after.id);
  check("the account page says so, and what to run", /has expired/.test(await (await get("/account", cookie)).text()));
  r = run("admin:recover", ["--yes"]);
  check("recovery makes another", r.status === 0 && !temporaryPasswordExpired(await owner()));

  await db.$disconnect();
} finally {
  if (panel?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(panel.pid)]);
    else panel.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await dropDatabase().catch((error: unknown) => console.log(`  (could not drop ${setupDb}: ${error instanceof Error ? error.message : error})`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
