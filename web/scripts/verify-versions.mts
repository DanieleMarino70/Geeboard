import "./load-env.mts";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import pg from "pg";
import { SignJWT } from "jose";
import { fetchWhenReady, startPanel, stopPanel, waitForPanel, type Panel } from "./verify-panel.mts";

/* The rule that keeps a panel and an agent from lying to each other.

   A panel and an agent work together when they share a release line —
   `major.minor` below 1.0, the major from 1.0 on. The interesting thing
   about the rule is that it is enforced three different ways on purpose,
   and getting any of the three wrong is worse than not having it:

     registration  refuses, so a mistake is caught in the terminal where
                   it was made
     heartbeat     never refuses, because an upgrade moves the panel
                   first and every node is one line behind until it
                   reaches them — refusing there would turn an upgrade
                   into an outage
     placement     refuses, so the node keeps what it runs and takes
                   nothing new
     rebuilds      refuse too — an update, a rollback, a rebuild, a
                   settings change that needs one — because each
                   downloads its build first, and an agent on another
                   line has nothing to download it with; refused before
                   the node is asked and before a value is written

   So this walks all three against a running panel: its own database, its
   own port, an owner made by `setup`, and the node page fetched with a
   real session cookie — because a banner that exists in a component and
   not on the page is not a banner.

   The database is a sibling of the one DATABASE_URL names, made here and
   dropped after. See docs/nodes.md#panel-and-agent-versions. */

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is not set");
const SESSION_SECRET = "verify-versions-Qm7Lx2Vc9Bn4Kp6Jh8Gf3Ds5Aa1Zz";
const SECRETS_KEY = "verify-versions-Yt5Re3Wq1Pl9Ok7Ij2Uh4Yg6Tf8Rd0";

const url = new URL(base);
const ownDb = `${url.pathname.replace(/^\//, "")}_versions`;
const ownUrl = new URL(base);
ownUrl.pathname = `/${ownDb}`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
adminUrl.search = "";

const PORT = 3300 + Math.floor(Math.random() * 90);
const PANEL = `http://127.0.0.1:${PORT}`;
const env: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: ownUrl.toString(),
  SESSION_SECRET,
  SECRETS_KEY,
  // Its own, never shared: two dev servers cannot use one build directory.
  GEEBOARD_DIST_DIR: ".next-versions",
};
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
function run(script: string, args: string[]) {
  const childEnv = env as NodeJS.ProcessEnv;
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
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [ownDb]);
    await client.query(`DROP DATABASE IF EXISTS "${ownDb}"`);
  });

let panel: Panel | undefined;

/* A node's agent that is not one: it writes down what it was asked, and
   answers a pull the way it is told to — as an agent from before 0.3.0
   does, with a 404, or as a registry that said no. Anything else is a 500,
   which the panel reads as a node it cannot see into. */
const calls: string[] = [];
let pulls: "missing" | "failing" = "missing";
const fake = createServer((req, res) => {
  calls.push(`${req.method} ${req.url?.split("?")[0]}`);
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/images/pull") {
    if (pulls === "missing") {
      res.writeHead(404).end(JSON.stringify({ error: "not found" }));
      return;
    }
    const now = new Date().toISOString();
    res.writeHead(200).end(
      JSON.stringify({
        image: "any",
        state: "failed",
        phase: "starting",
        layers: { total: 0, downloaded: 0, done: 0 },
        bytes: { current: 0, total: 0, totalKnown: false },
        startedAt: now,
        advancedAt: now,
        finishedAt: now,
        error: "the registry said no",
      }),
    );
    return;
  }
  res.writeHead(500).end(JSON.stringify({ error: "not this" }));
});
await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
const FAKE = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

try {
  console.log(`\n== a panel of its own, on ${ownDb} ==`);
  await dropDatabase();
  await admin((client) => client.query(`CREATE DATABASE "${ownDb}"`));
  const setup = run("setup", ["--email", "owner@example.com", "--name", "First Owner"]);
  check("setup made an owner and the catalog", setup.status === 0, setup.out.slice(-400));

  process.env.DATABASE_URL = ownUrl.toString();
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.SECRETS_KEY = SECRETS_KEY;

  const { db } = await import("../src/lib/db");
  const { createRegistrationTokenOp, registerNode, recordHeartbeat, approveNodeOp } = await import("../src/lib/node-ops");
  const { profileOf } = await import("../src/lib/create-ops");
  const { cannotRun, checkCompatibility } = await import("../src/domain/nodes/compatibility");
  const { requireGame } = await import("../src/domain/games/registry");
  const { PANEL_VERSION } = await import("../src/lib/version");
  const { releaseLine } = await import("../src/domain/nodes/agent-version");
  const { rebuildServerOp, rollbackServerOp, updateServerOp } = await import("../src/lib/update-ops");
  const { updateServerConfigOp } = await import("../src/lib/config-ops");

  check(
    `the panel knows what version it is (${PANEL_VERSION})`,
    releaseLine(PANEL_VERSION) !== null,
    "a script reads it from package.json through load-env.mts",
  );

  const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
  const ahead = `${Number(PANEL_VERSION.split(".")[0]) === 0 ? "0" : "9"}.${Number(PANEL_VERSION.split(".")[1] ?? 0) + 1}.0`;

  const tokenFor = async (nodeName: string) => {
    const issued = await createRegistrationTokenOp(owner, { nodeName });
    if (!issued.secret) throw new Error(`no token for ${nodeName}: ${issued.body ?? ""}`);
    return issued.secret;
  };
  const registration = (token: string, name: string, agentVersion: string) => ({
    token,
    name,
    advertiseUrl: `http://127.0.0.1:8080`,
    agentToken: "a".repeat(40),
    agentVersion,
    os: "linux",
    arch: "x64",
    capabilities: [],
    resources: { cpuCores: 4, ramTotalGb: 16, diskTotalGb: 200 },
  });

  console.log("\n== registration refuses an agent from another line ==");
  let refusal = "";
  try {
    await registerNode(registration(await tokenFor("wrong-line"), "wrong-line", ahead));
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  check("it is refused", refusal.length > 0, "it was accepted");
  check("and the message names both versions", refusal.includes(ahead) && refusal.includes(PANEL_VERSION), refusal);
  check("no node was written", (await db.node.count({ where: { name: "wrong-line" } })) === 0);

  console.log("\n== and accepts one on the same line ==");
  const samePatch = `${PANEL_VERSION.split(".").slice(0, 2).join(".")}.99`;
  await registerNode(registration(await tokenFor("right-line"), "right-line", samePatch));
  check(`a different patch of the same line joins (${samePatch})`, (await db.node.count({ where: { name: "right-line" } })) === 1);
  await approveNodeOp(owner, "right-line");

  console.log("\n== the heartbeat records and never refuses ==");
  /* The upgrade window: the panel is new, this node's agent is not yet.
     Its servers are running and it has to stay in service. */
  const beat = await recordHeartbeat({
    name: "right-line",
    token: "a".repeat(40),
    agentVersion: ahead,
    load: { cpuPct: 10, ramPct: 20, diskPct: 30 },
  });
  check("it is accepted", typeof beat.state === "string", JSON.stringify(beat));
  check("the node is not taken out of service", beat.state !== "UNREACHABLE", beat.state);
  const behind = await db.node.findUniqueOrThrow({ where: { name: "right-line" } });
  check("and the version it reported is what the panel now holds", behind.daemon === ahead, behind.daemon);

  console.log("\n== placement refuses it, so it takes nothing new ==");
  const reasons = cannotRun(
    checkCompatibility(requireGame("terraria"), await profileOf(behind), { memoryGb: 2, cpuLimit: 100, diskGb: 10 }),
  );
  check("the node cannot run a game", reasons.length > 0);
  check("for the version, in a sentence naming both", reasons.some((r) => r.includes(ahead) && r.includes(PANEL_VERSION)), reasons.join(" | "));

  console.log("\n== nor is it asked to rebuild what it runs ==");
  /* A server already on it, as one would be through an upgrade. The node
     answers at the fake agent's address, so anything asked of it shows. */
  await db.node.update({ where: { name: "right-line" }, data: { daemonUrl: FAKE } });
  const minecraft = requireGame("minecraft-java");
  const installable = minecraft.versions.find((v) => v.supported !== false)!;
  const onIt = await db.server.create({
    data: {
      slug: "on-the-old-line",
      name: "On the old line",
      game: minecraft.family,
      version: installable.label,
      gameId: minecraft.id,
      art: minecraft.art.split("\n")[0]!,
      state: "RUNNING",
      playersOn: 0,
      playersMax: minecraft.defaults.playersMax,
      host: "on-the-old-line.example.com",
      port: 25565,
      memoryLimit: 2,
      cpuLimit: 100,
      diskQuota: 10,
      runtimeId: "on-the-old-line-workload",
      nodeId: behind.id,
      ownerId: owner.id,
    },
  });
  calls.length = 0;
  const refusals = [
    await updateServerOp(owner, onIt.slug, installable.id),
    await rollbackServerOp(owner, onIt.slug),
    await rebuildServerOp(owner, onIt.slug),
  ];
  check(
    "an update, a rollback and a rebuild are each refused",
    refusals.every((r) => !r.ok),
    JSON.stringify(refusals.map((r) => r.title)),
  );
  check(
    "saying to upgrade the agent, and naming both versions",
    refusals.every((r) => r.body.includes("Upgrade the agent") && r.body.includes(ahead) && r.body.includes(PANEL_VERSION)),
    JSON.stringify(refusals.map((r) => r.body)),
  );
  const setting = await updateServerConfigOp(owner, onIt.slug, { maxPlayers: 31 }, { recreate: true });
  check("a setting that needs a rebuild is refused the same way", !setting.ok && setting.title === "Upgrade the agent first", JSON.stringify(setting));
  const unchanged = await db.server.findUniqueOrThrow({ where: { id: onIt.id } });
  check("before its value was written", unchanged.config === null, JSON.stringify(unchanged.config));
  check("and the server is left as it was", unchanged.state === "RUNNING" && unchanged.runtimeId === onIt.runtimeId, unchanged.state);
  check("the node was not asked anything", calls.length === 0, calls.join(", "));

  console.log("\n== the node's own page says so ==");
  panel = startPanel(PORT, env as NodeJS.ProcessEnv);
  await waitForPanel(panel, PANEL);
  check("the panel is running", true);

  /* A session for an owner who is past the gate: the banner is on a page
     a temporary password would never reach. */
  await db.user.update({
    where: { id: owner.id },
    data: {
      // What the gate reads: a password of their own, then two-factor.
      passwordSetAt: new Date(),
      temporaryPasswordExpiresAt: null,
      twoFactor: true,
      totpSecret: "verify-versions",
    },
  });
  const session = await db.session.create({
    data: { userId: owner.id, expiresAt: new Date(Date.now() + 3600_000), userAgent: "verify-versions" },
  });
  const jwt = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SESSION_SECRET));
  const cookie = `gb_session=${jwt}`;

  const asked = await fetchWhenReady(panel, `${PANEL}/nodes/right-line`, { headers: { cookie } });
  const page = asked.response;
  const html = page.status === 200 ? await page.text() : "";
  check("the page answers", page.status === 200, asked.detail);
  check("it shows the agent's version", html.includes(ahead), "not on the page");
  check("it shows the panel's", html.includes(PANEL_VERSION));
  check("and says new servers will not go there", /will not put new servers here/.test(html));

  console.log("\n== a node on the same line has no banner ==");
  await db.node.update({ where: { name: "right-line" }, data: { daemon: PANEL_VERSION } });
  const clean = await fetch(`${PANEL}/nodes/right-line`, { headers: { cookie }, redirect: "manual" });
  const cleanHtml = await clean.text();
  check("the warning is gone", !/will not put new servers here/.test(cleanHtml));
  check("the version is still shown", cleanHtml.includes(PANEL_VERSION));

  console.log("\n== an agent that cannot say its version is asked, and read for what it is ==");
  /* "unknown" is what registration stores for an agent that sent no
     version, and the rule has no standing to refuse it. One from before
     0.3.0 has no pull route and answers 404 — which, passed on as "not
     found", read as if the build were what was missing. */
  await db.node.update({ where: { name: "right-line" }, data: { daemon: "unknown" } });
  const before = await db.server.findUniqueOrThrow({ where: { id: onIt.id } });
  calls.length = 0;
  const old = await updateServerConfigOp(owner, onIt.slug, { maxPlayers: 31 }, { recreate: true });
  check("the node was asked for the build", calls.includes("POST /images/pull"), calls.join(", "));
  check("and its 404 is said as an agent to upgrade", !old.ok && /older than this panel\. Upgrade the agent/.test(old.body), old.body);

  console.log("\n== a download that fails before anything is touched changes nothing ==");
  /* The rebuild downloads before it destroys the old workload, so the old
     one is still there, on the settings it had. Putting it back would be
     the same download failing again — after which a server that never
     stopped was marked ERROR, its new values kept as if they applied. */
  pulls = "failing";
  calls.length = 0;
  const failed = await updateServerConfigOp(owner, onIt.slug, { maxPlayers: 32 }, { recreate: true });
  check("the change is refused with the node's reason", !failed.ok && failed.body.includes("the registry said no"), failed.body);
  check("and says nothing was changed", failed.body.includes("Nothing was changed"), failed.body);
  check("the node was not asked to destroy anything", !calls.some((a) => a.startsWith("DELETE")), calls.join(", "));
  const after = await db.server.findUniqueOrThrow({ where: { id: onIt.id } });
  check("the settings are the ones it had", JSON.stringify(after.config) === JSON.stringify(before.config), JSON.stringify(after.config));
  check(
    "and the server is where it was, not in ERROR",
    after.state === before.state && after.runtimeId === before.runtimeId && after.lastError === null,
    `${after.state} ${after.lastError ?? ""}`,
  );
  const recorded = await db.activityEvent.findFirst({
    where: { serverId: onIt.id, action: "server.config.failed" },
    orderBy: { createdAt: "desc" },
  });
  check(
    "the audit log says so too",
    (recorded?.changes as { Outcome?: { to?: string } } | null)?.Outcome?.to === "nothing was changed",
    JSON.stringify(recorded?.changes),
  );
} finally {
  fake.close();
  stopPanel(panel);
  await dropDatabase().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
