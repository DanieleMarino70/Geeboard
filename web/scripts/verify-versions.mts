import "./load-env.mts";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import pg from "pg";
import { SignJWT } from "jose";
import { fetchWhenReady, startPanel, stopPanel, waitForPanel, type Panel } from "./verify-panel.mts";

/* The rule that keeps a panel and an agent from lying to each other.

   A panel and an agent work together when they speak the same contract,
   whatever release each is; an agent that sends none is from 0.4.0 or
   before, and from 0.11 the panel does not work with it at all. The
   interesting thing about the rule is that it is enforced different ways
   on purpose, and getting any of them wrong is worse than not having it:

     registration  refuses another contract and no contract, so a
                   mistake is caught in the terminal where it was made
     heartbeat     refuses no contract, with the sentence that says what
                   to run, and keeps the version so the node's page says
                   it too; never refuses another number, because an
                   upgrade moves the panel first and every node is behind
                   until it reaches them — refusing there would turn an
                   upgrade into an outage
     placement     refuses, so the node keeps what it runs and takes
                   nothing new
     rebuilds      refuse too — an update, a rollback, a rebuild, a
                   settings change that needs one — because each
                   downloads its build first, through routes an agent
                   on another contract may not read the same way;
                   refused before the node is asked and before a value
                   is written

   So this walks them against a running panel: its own database, its
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
   answers a pull as a registry that said no. Anything else is a 500,
   which the panel reads as a node it cannot see into. */
const calls: string[] = [];
const fake = createServer((req, res) => {
  calls.push(`${req.method} ${req.url?.split("?")[0]}`);
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/images/pull") {
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
  const { FIRST_CONTRACT_AGENT, PANEL_CONTRACT } = await import("../src/domain/nodes/agent-version");
  const { agentRefusal, rebuildServerOp, rollbackServerOp, updateServerOp } = await import("../src/lib/update-ops");
  const { updateServerConfigOp } = await import("../src/lib/config-ops");

  check(
    `the panel knows what version it is (${PANEL_VERSION})`,
    /^\d+\.\d+\.\d+/.test(PANEL_VERSION),
    "a script reads it from package.json through load-env.mts",
  );

  const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
  // A release the line rule would have refused: the contract is what decides now.
  const ahead = `${Number(PANEL_VERSION.split(".")[0]) === 0 ? "0" : "9"}.${Number(PANEL_VERSION.split(".")[1] ?? 0) + 1}.0`;
  const OLD = "0.4.0";
  const OTHER = PANEL_CONTRACT + 1;

  const tokenFor = async (nodeName: string) => {
    const issued = await createRegistrationTokenOp(owner, { nodeName });
    if (!issued.secret) throw new Error(`no token for ${nodeName}: ${issued.body ?? ""}`);
    return issued.secret;
  };
  const registration = (token: string, name: string, agentVersion: string, agentContract?: unknown) => ({
    token,
    name,
    advertiseUrl: `http://127.0.0.1:8080`,
    agentToken: "a".repeat(40),
    agentVersion,
    ...(agentContract === undefined ? {} : { agentContract }),
    os: "linux",
    arch: "x64",
    capabilities: [],
    resources: { cpuCores: 4, ramTotalGb: 16, diskTotalGb: 200 },
  });
  const refusedWith = async (attempt: () => Promise<unknown>) => {
    try {
      await attempt();
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  // The sentence an agent from before the contract is refused with: its version, the one needed, and how to get there.
  const saysWhatToRun = (text: string, version: string) =>
    text.includes(version) && text.includes(`${FIRST_CONTRACT_AGENT} or later`) && text.includes("deploy/linux/install.sh") && text.includes("install-node.ps1");

  console.log("\n== registration refuses an agent that sends no contract ==");
  const noContract = await refusedWith(async () => registerNode(registration(await tokenFor("no-contract"), "no-contract", OLD)));
  check("it is refused", noContract.length > 0, "it was accepted");
  check(`in one sentence: its version, ${FIRST_CONTRACT_AGENT} or later, and the upgrade command`, saysWhatToRun(noContract, OLD), noContract);
  check("no node was written", (await db.node.count({ where: { name: "no-contract" } })) === 0);
  const sameRelease = await refusedWith(async () => registerNode(registration(await tokenFor("no-contract-same"), "no-contract-same", PANEL_VERSION)));
  check("whatever release it calls itself, the panel's own included", saysWhatToRun(sameRelease, PANEL_VERSION), sameRelease);
  const nonsense = await refusedWith(async () => registerNode(registration(await tokenFor("nonsense"), "nonsense", PANEL_VERSION, "1")));
  check("something that is not a contract is no contract", saysWhatToRun(nonsense, PANEL_VERSION), nonsense);

  console.log("\n== and one that speaks another contract ==");
  const other = await refusedWith(async () => registerNode(registration(await tokenFor("other-contract"), "other-contract", PANEL_VERSION, OTHER)));
  check("it is refused", other.length > 0, "it was accepted");
  check("the message names both contracts", other.includes(`contract ${OTHER}`) && other.includes(`contract ${PANEL_CONTRACT}`), other);
  check("no node was written", (await db.node.count({ where: { name: "other-contract" } })) === 0);

  console.log("\n== an agent that speaks the panel's contract joins, whatever release it is ==");
  await registerNode(registration(await tokenFor("same-contract"), "same-contract", ahead, PANEL_CONTRACT));
  const joined = await db.node.findUnique({ where: { name: "same-contract" } });
  check(`it joins from another line (${ahead}), which the old line rule would refuse`, joined !== null, "refused");
  check("and the panel holds the contract it reported, beside the version", joined?.contract === PANEL_CONTRACT && joined?.daemon === ahead, JSON.stringify([joined?.contract, joined?.daemon]));
  await approveNodeOp(owner, "same-contract");

  const beatAs = (agentVersion: string | undefined, agentContract: unknown, load = { cpuPct: 10, ramPct: 20, diskPct: 30 }) =>
    recordHeartbeat({ name: "same-contract", token: "a".repeat(40), agentVersion, agentContract, load });
  const node = () => db.node.findUniqueOrThrow({ where: { name: "same-contract" } });
  const reasonsFor = async () => cannotRun(checkCompatibility(requireGame("terraria"), await profileOf(await node()), { memoryGb: 2, cpuLimit: 100, diskGb: 10 }));

  console.log("\n== the heartbeat records another contract and does not refuse it ==");
  /* The upgrade window: the panel is new, this node's agent is not yet.
     Its servers are running and it has to stay in service. */
  const beat = await beatAs(ahead, OTHER);
  check("it is accepted", typeof beat.state === "string", JSON.stringify(beat));
  check("the node is not taken out of service", beat.state !== "UNREACHABLE", beat.state);
  check("and the contract it reported is what the panel now holds", (await node()).contract === OTHER, String((await node()).contract));
  const byNumber = (await reasonsFor()).filter((r) => r.includes(ahead));
  check("placement refuses, in a sentence about contracts", byNumber.length > 0 && byNumber.every((r) => r.includes(`contract ${OTHER}`) && r.includes(`contract ${PANEL_CONTRACT}`)), (await reasonsFor()).join(" | "));

  console.log("\n== and refuses an agent that sends none, saying what to run ==");
  await beatAs(ahead, PANEL_CONTRACT, { cpuPct: 10, ramPct: 20, diskPct: 30 });
  const refusedBeat = await refusedWith(() => beatAs(OLD, undefined, { cpuPct: 99, ramPct: 99, diskPct: 99 }));
  check("the beat is refused", refusedBeat.length > 0, "it was accepted");
  check("with the sentence, which the agent's log prints", saysWhatToRun(refusedBeat, OLD), refusedBeat);
  const old = await node();
  check("the panel keeps the version it gave and drops the contract it had", old.daemon === OLD && old.contract === null, JSON.stringify([old.daemon, old.contract]));
  check("and believes nothing else it said", old.cpuPct === 10 && old.ramPct === 20, JSON.stringify([old.cpuPct, old.ramPct]));
  const byNone = (await reasonsFor()).filter((r) => r.includes(OLD));
  check("placement refuses it, with the same sentence", byNone.length > 0 && byNone.every((r) => saysWhatToRun(r, OLD)), (await reasonsFor()).join(" | "));
  const unsaid = await refusedWith(() => beatAs(undefined, null));
  check("a beat that gives no version either is refused the same way", unsaid.includes(`${FIRST_CONTRACT_AGENT} or later`) && unsaid.includes(OLD), unsaid);

  console.log("\n== nor is it asked to rebuild what it runs ==");
  /* A server already on it, as one would be through an upgrade. The node
     answers at the fake agent's address, so anything asked of it shows. */
  await db.node.update({ where: { name: "same-contract" }, data: { daemonUrl: FAKE } });
  const minecraft = requireGame("minecraft-java");
  const installable = minecraft.versions.find((v) => v.supported !== false)!;
  const onIt = await db.server.create({
    data: {
      slug: "before-the-contract",
      name: "Before the contract",
      game: minecraft.family,
      version: installable.label,
      gameId: minecraft.id,
      art: minecraft.art.split("\n")[0]!,
      state: "RUNNING",
      playersOn: 0,
      playersMax: minecraft.defaults.playersMax,
      host: "before-the-contract.example.com",
      port: 25565,
      memoryLimit: 2,
      cpuLimit: 100,
      diskQuota: 10,
      runtimeId: "before-the-contract-workload",
      nodeId: old.id,
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
    `saying to upgrade the agent, naming it and ${FIRST_CONTRACT_AGENT}`,
    refusals.every((r) => r.body.includes("Upgrade the agent") && r.body.includes(OLD) && r.body.includes(`${FIRST_CONTRACT_AGENT} or later`)),
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

  const asked = await fetchWhenReady(panel, `${PANEL}/nodes/same-contract`, { headers: { cookie } });
  const page = asked.response;
  const html = page.status === 200 ? await page.text() : "";
  check("the page answers", page.status === 200, asked.detail);
  check("it shows the agent's version and the panel's", html.includes(OLD) && html.includes(PANEL_VERSION), "not on the page");
  check(`and says ${FIRST_CONTRACT_AGENT} or later is needed, and how to get it`, saysWhatToRun(html, OLD));

  console.log("\n== a node on the panel's contract has no banner, on any release ==");
  await beatAs(ahead, PANEL_CONTRACT);
  const agreeing = await (await fetch(`${PANEL}/nodes/same-contract`, { headers: { cookie }, redirect: "manual" })).text();
  check("it shows the contract beside the version", agreeing.includes(`${ahead} · contract ${PANEL_CONTRACT}`));
  check("with no banner, though the release is another line", !/will not put new servers here|from before the contract/.test(agreeing));
  check("placement has nothing to say against it", !(await reasonsFor()).some((r) => r.includes(ahead)), (await reasonsFor()).join(" | "));
  check("nor do the rebuilds", agentRefusal(await node()) === null, String(agentRefusal(await node())));
  await beatAs(ahead, OTHER);
  const disagreeing = await (await fetch(`${PANEL}/nodes/same-contract`, { headers: { cookie }, redirect: "manual" })).text();
  check("another number gets the banner, naming both contracts", /will not put new servers here/.test(disagreeing) && disagreeing.includes(`contract ${OTHER}`) && disagreeing.includes(`contract ${PANEL_CONTRACT}`));
  calls.length = 0;
  const rebuild = await rebuildServerOp(owner, onIt.slug);
  // The running panel looks in on its nodes now and then; that is not the rebuild asking.
  check("a rebuild is refused the same way, before the node is asked", !rebuild.ok && rebuild.body.includes(`contract ${OTHER}`) && rebuild.body.includes("Upgrade the agent") && calls.filter((c) => c !== "GET /health").length === 0, JSON.stringify([rebuild.body, calls]));

  console.log("\n== a download that fails before anything is touched changes nothing ==");
  /* The rebuild downloads before it destroys the old workload, so the old
     one is still there, on the settings it had. Putting it back would be
     the same download failing again — after which a server that never
     stopped was marked ERROR, its new values kept as if they applied. */
  await beatAs(PANEL_VERSION, PANEL_CONTRACT);
  const before = await db.server.findUniqueOrThrow({ where: { id: onIt.id } });
  calls.length = 0;
  const failed = await updateServerConfigOp(owner, onIt.slug, { maxPlayers: 32 }, { recreate: true });
  check("the node was asked for the build", calls.includes("POST /images/pull"), calls.join(", "));
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
