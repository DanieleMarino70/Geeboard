import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Attaching a machine, the way a person does it.

   Every other Docker-backed script attaches its agent by writing
   daemonUrl and daemonToken straight into the node row. That is exactly
   the step a person cannot take, and it is why "Add a node" could be
   broken end to end — a disabled button, a bash-only command full of
   placeholders, an agent reporting "windows" from a machine running Linux
   containers — while every check passed.

   So nothing here touches a node row to make it work. The panel mints a
   token; the command the Add a node dialog shows is built and its join
   run for real; the agent calls the panel's real register and heartbeat
   route handlers over HTTP, is stopped, and starts again from what join
   saved and nothing else; a person approves;
   and then a server is created, stopped, started and deleted through
   the same operations the panel's buttons call. The only rows this
   script writes directly are the ones it deliberately damages, to prove
   a heartbeat repairs them. */

const { db } = await import("../src/lib/db");
const { decryptSecret } = await import("../src/lib/secrets");
const { seed, seedEmpty } = await import("../prisma/seed");
const { joinCommand } = await import("../src/lib/agent-command");

/** A token nobody issued, for the requests that are meant to be refused. */
const strangerToken = () => randomBytes(32).toString("hex");
const { createRegistrationTokenOp, approveNodeOp, registerNode, registrationProgressOp, removeNodeOp, rotateAgentTokenOp } =
  await import("../src/lib/node-ops");
const { createServerOp, nodeProfiles } = await import("../src/lib/create-ops");
const { createBackupOp, deleteServerOp, setNodeDrainOp, startServerOp, stopServerOp } = await import(
  "../src/lib/server-ops"
);
const { pollOnce } = await import("../src/lib/poller");
const { placeServer } = await import("../src/domain/nodes/placement");
const { allGames, requireGame } = await import("../src/domain/games/registry");
const register = await import("../src/app/api/v1/nodes/register/route");
const heartbeat = await import("../src/app/api/v1/nodes/heartbeat/route");

const NODE = "verify-reg-01";
const AGENT_PORT = 8800 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-registration";
const ALPINE = "alpine:3.20";
const TERRARIA = requireGame("terraria");
const VERSION = TERRARIA.versions.find((v) => v.recommended)!;
/* A committed alpine wears the Terraria image's name for the duration,
   as verify:create does for Minecraft: what is under test is attaching a
   node and driving it, not Re-Logic's server binary, and pulling one is
   somebody else's bandwidth. The real image's tag is put back after. */
const FIXTURE = VERSION.image;

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

const docker = new Docker();
let agent: ChildProcess | undefined;
let agentOutput = "";
let panel: HttpServer | undefined;
let dataRoot = "";
let previousFixtureId: string | null = null;

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 60, everyMs = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  console.log(`  (timed out waiting for ${label})`);
  return false;
}

async function sweep() {
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => {});
  }
}

/* The panel's own route handlers, served over plain HTTP.

   Not a stub: these are the exported POST functions Next would call, fed
   a real Request and answered with their real Response. What is left out
   is Next's router, which has nothing to do with whether registration
   works — and leaving it out means this runs without a dev server. */
async function servePanel(): Promise<string> {
  const routes: Record<string, (req: Request) => Promise<Response>> = {
    "/api/v1/nodes/register": register.POST,
    "/api/v1/nodes/heartbeat": heartbeat.POST,
  };

  panel = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const handler = req.method === "POST" ? routes[req.url ?? ""] : undefined;
    const response = handler
      ? await handler(
          new Request(`http://127.0.0.1${req.url}`, {
            method: "POST",
            headers,
            body: Buffer.concat(chunks),
          }),
        )
      : new Response(JSON.stringify({ message: "not found" }), { status: 404 });

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise<void>((resolve) => panel!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
}

/** Where the agent keeps servers: inside this run's directory, and not created until one is. */
function nodeRoot() {
  return path.join(dataRoot, "servers");
}

/* The arguments the pasted bash line hands `join`, read back out of it.
   The line is the Linux install, which passes everything after the
   script's name to join unchanged. */
const INSTALL = "sudo deploy/linux/install.sh ";
function joinArgumentsOf(command: string): string[] | null {
  const line = command.split("\n").find((l) => l.startsWith(INSTALL));
  if (!line) return null;
  return [...line.slice(INSTALL.length).matchAll(/'((?:[^']|'\\'')*)'|(--[a-z-]+)/g)].map(
    (m) => m[2] ?? m[1]!.replace(/'\\''/g, "'"),
  );
}

/** This process's environment without any agent settings a developer's shell might carry. */
function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GEEBOARD_")),
  ) as NodeJS.ProcessEnv;
}

function captureOutput(child: ChildProcess) {
  child.stdout!.on("data", (chunk: Buffer) => (agentOutput += chunk.toString("utf8")));
  child.stderr!.on("data", (chunk: Buffer) => (agentOutput += chunk.toString("utf8")));
}

try {
  await docker.ping();

  console.log("\n== an empty workspace ==");
  await seedEmpty();
  check("no nodes", (await db.node.count()) === 0);
  check("no servers", (await db.server.count()) === 0);
  /* Against the registry, not against a number typed once. This said 8,
     which was right when eight games were offered and wrong from the day
     three were parked — and it went on passing anyway, because a database
     that has been through a catalog sync keeps the retired rows. On a
     database made this morning it failed, which is what it should have
     done all along. */
  check("the game catalog is there", (await db.game.count()) === allGames().length);
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  check("and one owner to sign in as", mara.role === "OWNER" && (await db.user.count()) === 1);

  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-registration-"));
  await sweep();
  const panelUrl = await servePanel();

  console.log("\n== minting a token for a named node ==");
  const member = await db.user.create({
    data: { email: "member@ashfold.gg", name: "Member", initials: "ME", role: "MEMBER", passwordHash: "x" },
  });
  const refused = await createRegistrationTokenOp(member, { nodeName: NODE });
  check("a member cannot mint one", !refused.ok, refused.title);

  const badName = await createRegistrationTokenOp(mara, { nodeName: "Not A Name" });
  check("a name the agent would be refused for is refused here first", !badName.ok, badName.title);

  const minted = await createRegistrationTokenOp(mara, { nodeName: NODE });
  check("an owner can", minted.ok && Boolean(minted.secret), minted.body);
  const secret = minted.secret!;
  const row = await db.nodeRegistrationToken.findUniqueOrThrow({ where: { id: minted.tokenId! } });
  check("the token is bound to the name", row.nodeName === NODE, String(row.nodeName));
  check("and stored hashed, not as the secret", row.hash !== secret && !row.hash.includes(secret));
  check(
    "progress says it is waiting",
    (await registrationProgressOp(mara, row.id)).state === "waiting",
  );

  console.log("\n== a token registers only the name it was minted for ==");
  let wrongName = "";
  try {
    await registerNode({
      token: secret,
      name: "someone-else",
      advertiseUrl: "http://127.0.0.1:1",
      agentToken: strangerToken(),
      agentVersion: "0.1.0",
      capabilities: [],
      resources: { cpuCores: 1, ramTotalGb: 1, diskTotalGb: 1 },
    });
  } catch (error) {
    wrongName = (error as Error).message;
  }
  check("a different name is refused", /different node name/.test(wrongName), wrongName);
  check("without spending the token", !(await db.nodeRegistrationToken.findUniqueOrThrow({ where: { id: row.id } })).usedAt);
  check("and without writing a node", (await db.node.count()) === 0);

  console.log("\n== the command the dialog shows, run for real ==");
  const command = joinCommand({ panelUrl, registrationToken: secret, capabilities: [], advertiseUrl: "" }, "bash");
  const joinArgs = joinArgumentsOf(command);
  check("it is an install and a join", /^sudo deploy\/linux\/install\.sh /m.test(command) && joinArgs !== null, command);
  check("with the panel's address and the token, and nothing else", JSON.stringify(joinArgs) === JSON.stringify([panelUrl, secret]), JSON.stringify(joinArgs));
  check("no agent token, no node name, no variables", !/GEEBOARD_|DAEMON_TOKEN/.test(command) && !command.includes(NODE));

  const engine = (await docker.info()) as { OSType: string; Architecture: string };
  const agentFile = path.join(dataRoot, "profile", "agent.json");
  /* Isolation from anything else on this machine, not configuration: the
     label keeps its containers apart, the file stays out of the real
     profile, and the listening address stays on loopback. */
  const isolated: NodeJS.ProcessEnv = {
    ...cleanEnvironment(),
    GEEBOARD_AGENT_FILE: agentFile,
    GEEBOARD_MANAGED_LABEL: LABEL,
    GEEBOARD_DAEMON_HOST: "127.0.0.1",
  };

  agent = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/join.ts",
      ...(joinArgs ?? []),
      // Chosen, as somebody could on the machine: a free port for this run,
      // and a data root that does not exist yet, as on any machine that has
      // never run a server — which is where the agent used to report a disk
      // of nothing.
      "--port",
      String(AGENT_PORT),
      "--data-root",
      nodeRoot(),
    ],
    { cwd: path.join(process.cwd(), "..", "daemon"), env: isolated, stdio: ["ignore", "pipe", "pipe"] },
  );
  captureOutput(agent);

  const appeared = await waitFor(async () => Boolean(await db.node.findUnique({ where: { name: NODE } })), "registration");
  check("the node registers itself, under the name its token was issued for", appeared, agentOutput);

  const pending = await db.node.findUniqueOrThrow({ where: { name: NODE } });
  check("as PENDING", pending.state === "PENDING", pending.state);
  check("unapproved", pending.approvedAt === null);
  /* Nobody typed this address. The agent took it from its own connection
     to the panel — loopback here, a LAN address across a network. */
  check(
    "at the address it worked out, on the port it was given",
    pending.daemonUrl === `http://127.0.0.1:${AGENT_PORT}`,
    String(pending.daemonUrl),
  );

  /* Waited for, not read once. The node row appears while the panel is
     still answering the registration; join writes its file only after
     the answer arrives, and on a busy machine the read used to win that
     race and find nothing. */
  type Saved = { nodeName?: string; panelUrl?: string; token?: string };
  const saved: { value: Saved | null } = { value: null };
  await waitFor(async () => {
    saved.value = JSON.parse(await readFile(agentFile, "utf8")) as Saved;
    return Boolean(saved.value.nodeName);
  }, "join to save its settings");
  const joined = saved.value;
  check("join wrote down what it joined with", joined?.nodeName === NODE && joined.panelUrl === panelUrl, JSON.stringify({ ...joined, token: "…" }));
  const agentToken = joined?.token ?? "";
  check("including a token of its own making", /^[0-9a-f]{64}$/.test(agentToken));
  check(
    "and the agent answers where it said it would",
    await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_PORT}/health`)).ok, "the agent to listen"),
    agentOutput,
  );
  check(
    "on the engine's OS, not the host's",
    pending.os === engine.OSType.toLowerCase(),
    `${pending.os} vs engine ${engine.OSType}`,
  );
  check(
    "and the engine's architecture, in the games' vocabulary",
    pending.arch === ({ x86_64: "x64", amd64: "x64", aarch64: "arm64", arm64: "arm64" } as Record<string, string>)[engine.Architecture],
    `${pending.arch} vs engine ${engine.Architecture}`,
  );
  check("with docker among its capabilities", pending.capabilities.includes("docker"), pending.capabilities.join(","));
  check(
    "and the disk its data root will live on, though that directory does not exist yet",
    pending.diskTotal > 1,
    `${pending.diskTotal} GB`,
  );
  check("its agent token stored encrypted", pending.daemonToken !== null && pending.daemonToken !== agentToken);
  check("and decrypting to the one the agent made", decryptSecret(pending.daemonToken!) === agentToken);

  const spent = await db.nodeRegistrationToken.findUniqueOrThrow({ where: { id: row.id } });
  check("the token is spent", spent.usedAt !== null && spent.usedByNode === NODE);
  check("the registration is in the activity log", Boolean(await db.activityEvent.findFirst({ where: { action: "node.registered", target: NODE } })));
  const progress = await registrationProgressOp(mara, row.id);
  check(
    "and the dialog's poll sees it, unapproved",
    progress.state === "registered" && !progress.node.approved,
    JSON.stringify(progress),
  );
  // The same race for its message, which is printed after the file is saved.
  await waitFor(async () => /approve it in the panel/.test(agentOutput), "join's message");
  check(
    "join said so, and printed neither token",
    /approve it in the panel/.test(agentOutput) && !agentOutput.includes(agentToken) && !agentOutput.includes(secret),
    agentOutput,
  );

  console.log("\n== npm start, from what join saved ==");
  /* The whole point of join: the machine restarts, and starting the agent
     takes nothing but the file. No token, no name, no panel address. */
  agent.kill();
  await new Promise((resolve) => agent!.once("exit", resolve));
  agentOutput = "";
  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: isolated,
    stdio: ["ignore", "pipe", "pipe"],
  });
  captureOutput(agent);
  check(
    "it starts again, answering on the same port",
    await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_PORT}/health`)).ok, "the restarted agent"),
    agentOutput,
  );
  /* Read out of the agent's own log line, which is JSON when its output
     is a pipe rather than a terminal — as it is here, and under systemd
     and Docker. It used to be a sentence, and matching on the sentence is
     what broke when the agent started logging structured lines. */
  check(
    "under the node's name",
    agentOutput.split("\n").some((line) => {
      try {
        const entry = JSON.parse(line) as { msg?: string; node?: string };
        return entry.msg === "agent listening" && entry.node === NODE;
      } catch {
        return false;
      }
    }),
    agentOutput,
  );

  console.log("\n== a pending node is not in service ==");
  const early = await createServerOp(mara, {
    gameId: TERRARIA.id,
    versionId: VERSION.id,
    templateId: "classic",
    nodeName: NODE,
    name: "Too Early",
    host: "early.ashfold.gg",
    memoryGb: 2,
    cpuLimit: 100,
    diskGb: 10,
  });
  check("nothing can be created on it", !early.ok && /not approved/.test(early.title), early.title);
  check("the watchdog does not poll it", (await pollOnce()).nodesChecked === 0);

  let reuse = "";
  try {
    await registerNode({
      token: secret,
      name: NODE,
      advertiseUrl: "http://127.0.0.1:1",
      agentToken: strangerToken(),
      agentVersion: "0.1.0",
      capabilities: [],
      resources: { cpuCores: 1, ramTotalGb: 1, diskTotalGb: 1 },
    });
  } catch (error) {
    reuse = (error as Error).message;
  }
  check("a spent token cannot re-point it", /not valid/.test(reuse), reuse);
  check(
    "and its address is unchanged",
    (await db.node.findUniqueOrThrow({ where: { name: NODE } })).daemonUrl === `http://127.0.0.1:${AGENT_PORT}`,
  );

  console.log("\n== approving puts it in service ==");
  const approved = await approveNodeOp(mara, NODE);
  check("approval succeeds", approved.ok, approved.body);
  const live = await db.node.findUniqueOrThrow({ where: { name: NODE } });
  check("it is HEALTHY", live.state === "HEALTHY", live.state);
  check("with an approver recorded", live.approvedById === mara.id);

  console.log("\n== heartbeats keep it current, and repair it ==");
  /* Damage the row the way reality does: a platform recorded wrong (the
     bug this flow shipped with), and a silence long enough to have
     degraded it. The next heartbeat has to put both right. */
  const before = new Date(Date.now() - 10 * 60_000);
  await db.node.update({
    where: { name: NODE },
    data: { os: "windows", state: "DEGRADED", lastSeenAt: before, diskTotal: 1 },
  });
  const repaired = await waitFor(
    async () => {
      const n = await db.node.findUniqueOrThrow({ where: { name: NODE } });
      return (
        n.state === "HEALTHY" &&
        n.os === engine.OSType.toLowerCase() &&
        n.diskTotal > 1 &&
        (n.lastSeenAt ?? before) > before
      );
    },
    "a heartbeat",
    50,
  );
  check("a heartbeat arrives within its interval, restoring platform, state and size", repaired);
  check(
    "the recovery is recorded",
    Boolean(await db.activityEvent.findFirst({ where: { action: "node.recovered", target: NODE } })),
  );
  check(
    "and so is the platform change",
    Boolean(await db.activityEvent.findFirst({ where: { action: "node.platform.changed", target: NODE } })),
  );

  const forged = await fetch(`${panelUrl}/api/v1/nodes/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: NODE, token: strangerToken(), os: "windows" }),
  });
  check("a heartbeat with the wrong token is refused", forged.status === 401, String(forged.status));
  check(
    "and changes nothing",
    (await db.node.findUniqueOrThrow({ where: { name: NODE } })).os === engine.OSType.toLowerCase(),
  );

  console.log("\n== its token is rotated while it stays in service ==");
  const tokenBefore = (JSON.parse(await readFile(agentFile, "utf8")) as { token: string }).token;
  const asAgent = (token: string) => fetch(`http://127.0.0.1:${AGENT_PORT}/version`, { headers: { authorization: `Bearer ${token}` } });
  const rotated = await rotateAgentTokenOp(mara, NODE);
  check("the rotation is confirmed by the agent", rotated.ok && rotated.tone === "success", JSON.stringify(rotated));
  check("and the token is in neither half of the answer", !JSON.stringify(rotated).includes(tokenBefore) && !/[a-f0-9]{64}/.test(JSON.stringify(rotated)));
  const fileAfter = JSON.parse(await readFile(agentFile, "utf8")) as { token: string; previousToken?: string };
  check("the agent saved a new one and kept no old one", fileAfter.token !== tokenBefore && fileAfter.previousToken === undefined);
  check("the panel holds that same token, encrypted", decryptSecret((await db.node.findUniqueOrThrow({ where: { name: NODE } })).daemonToken!) === fileAfter.token);
  check("the old token no longer opens the agent", (await asAgent(tokenBefore)).status === 401);
  check("the new one does", (await asAgent(fileAfter.token)).status === 200);
  check("the panel still reaches the node", (await pollOnce()).nodesUnreachable === 0);
  const seenBefore = (await db.node.findUniqueOrThrow({ where: { name: NODE } })).lastSeenAt;
  const heard = await waitFor(
    async () => ((await db.node.findUniqueOrThrow({ where: { name: NODE } })).lastSeenAt?.getTime() ?? 0) > (seenBefore?.getTime() ?? 0),
    "a heartbeat under the new token",
    40,
    1000,
  );
  check("and the agent's heartbeats are accepted under the new token", heard);
  check("it is in the audit log", (await db.activityEvent.count({ where: { action: "node.token.rotated", target: NODE } })) === 1);

  console.log("\n== placement can see it ==");
  const placement = placeServer(
    { game: TERRARIA, resources: { memoryGb: 2, cpuLimit: 100, diskGb: 10 } },
    await nodeProfiles(),
  );
  check("Terraria is recommended onto it", placement.recommended?.node === NODE, JSON.stringify(placement.refusal));
  check(
    "as compatible, not merely partial",
    placement.recommended?.compatibility.verdict === "compatible",
    placement.recommended?.compatibility.verdict,
  );

  console.log("\n== a real server on the node it registered ==");
  await docker.pull(ALPINE).then(
    (stream: NodeJS.ReadableStream) =>
      new Promise<void>((resolve, reject) =>
        docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve())),
      ),
  );
  previousFixtureId = await docker
    .getImage(FIXTURE)
    .inspect()
    .then((i) => i.Id)
    .catch(() => null);
  const stand = await docker.createContainer({
    Image: ALPINE,
    Labels: { [LABEL]: "fixture" },
    /* Behaves like the game in the one way this checks: it reads its
       console and leaves when told Terraria's stop command. Everything
       else it hears is echoed, so a command can be seen arriving. */
    Cmd: ["sh", "-c", 'echo "Server started"; while read line; do [ "$line" = exit ] && echo "Saving before exit" && exit 0; echo "recv: $line"; done'],
  });
  const [repo, tag] = FIXTURE.split(":") as [string, string];
  await stand.commit({ repo, tag });
  await stand.remove({ force: true });

  const created = await createServerOp(mara, {
    gameId: TERRARIA.id,
    versionId: VERSION.id,
    templateId: "classic",
    nodeName: NODE,
    name: "Registered World",
    host: "registered.ashfold.gg",
    memoryGb: 2,
    cpuLimit: 100,
    diskGb: 10,
  });
  check("createServerOp creates it", created.ok, created.body);
  const server = await db.server.findUniqueOrThrow({ where: { slug: created.slug ?? "registered-world" } });
  check("running, with a runtime handle", server.state === "RUNNING" && Boolean(server.runtimeId), server.state);

  const inspect = await docker.getContainer(server.runtimeId!).inspect();
  check("Docker agrees it is up", inspect.State.Running);
  check("labelled back to its server", inspect.Config.Labels[LABEL] === server.id);
  const config = await readFile(path.join(nodeRoot(), server.id, "serverconfig.txt"), "utf8").catch(() => "");
  check("its config file was written on the node before it started", /maxplayers=16/.test(config), config);
  check("naming the world inside the server's own directory", /^world=\/data\/geeboard\.wld$/m.test(config), config);
  check(
    "and the image is told to read it from there",
    inspect.Config.Env.includes("CONFIGPATH=/data") && !inspect.Config.Env.some((e) => /^WORLD_FILENAME=./.test(e)),
    inspect.Config.Env.join(" "),
  );
  check(
    "with the game's port published onto the one it listens on",
    JSON.stringify(inspect.HostConfig.PortBindings ?? {}).includes('"7777/tcp"'),
    JSON.stringify(inspect.HostConfig.PortBindings),
  );

  const stopStarted = Date.now();
  const stopped = await stopServerOp(mara, server.slug);
  const stopMs = Date.now() - stopStarted;
  check("stop works", stopped.ok, stopped.body);
  check("the panel says stopped", (await db.server.findUniqueOrThrow({ where: { id: server.id } })).state === "STOPPED");
  const afterStop = await docker.getContainer(server.runtimeId!).inspect();
  check("and so does Docker", !afterStop.State.Running);
  /* Asked, not killed: the game's own stop command went to its console
     and it left by itself, where a signal would have waited out thirty
     seconds and ended in 137 with the world unsaved. */
  check("it exited on the game's stop command", afterStop.State.ExitCode === 0, String(afterStop.State.ExitCode));
  check("in seconds, not the signal's grace period", stopMs < 15_000, `${stopMs}ms`);

  const started = await startServerOp(mara, server.slug);
  check("start works", started.ok, started.body);
  check("the panel says running", (await db.server.findUniqueOrThrow({ where: { id: server.id } })).state === "RUNNING");
  check("and so does Docker", (await docker.getContainer(server.runtimeId!).inspect()).State.Running);

  const pass1 = await pollOnce();
  check("the watchdog now polls the node", pass1.nodesChecked === 1 && pass1.nodesUnreachable === 0, JSON.stringify(pass1));
  check("and its server, without errors", pass1.serversChecked === 1 && pass1.errors.length === 0, pass1.errors.join("; "));

  const backup = await createBackupOp(mara, server.slug);
  check("a backup is taken", backup.ok, backup.body);
  const archives = path.join(nodeRoot(), ".backups", server.id);
  check("and written beside the server's data on the node", (await readdir(archives).catch(() => [])).length === 1);

  console.log("\n== retiring the node ==");
  const withServer = await removeNodeOp(mara, NODE, NODE);
  check("a node with a server on it cannot be removed", !withServer.ok && /Move it to another node, or delete it, first/.test(withServer.body), withServer.body);

  const deleted = await deleteServerOp(mara, server.slug, server.name);
  check("delete works", deleted.ok, deleted.body);
  let gone = false;
  await docker.getContainer(server.runtimeId!).inspect().catch(() => (gone = true));
  check("and the container is gone", gone);
  check("so is its world", !(await readdir(nodeRoot())).includes(server.id));
  /* The panel's backup rows go with the server. The archives used to
     stay on the node — invisible, unrestorable, filling the disk — while
     the delete said every snapshot was gone. */
  check("and so are its backups, as the delete says", !(await readdir(archives).then(() => true).catch(() => false)));
  check("with no backup rows left behind either", (await db.backup.count({ where: { serverId: server.id } })) === 0);

  const leftover = await createRegistrationTokenOp(mara, { nodeName: NODE });
  check("a spare token for the name exists", leftover.ok);

  const inRotation = await removeNodeOp(mara, NODE, NODE);
  check("an empty node still in rotation cannot be removed", !inRotation.ok && /Drain/.test(inRotation.body), inRotation.body);

  const drained = await setNodeDrainOp(mara, NODE, true);
  check("draining works", drained.ok, drained.body);

  const typo = await removeNodeOp(mara, NODE, "verify-reg-1");
  check("a mistyped confirmation refuses", !typo.ok && /does not match/.test(typo.title), typo.title);

  const notAllowed = await removeNodeOp(member, NODE, NODE);
  check("a member cannot remove a node", !notAllowed.ok, notAllowed.title);
  check("and after every refusal the node is still there", Boolean(await db.node.findUnique({ where: { name: NODE } })));

  const removed = await removeNodeOp(mara, NODE, NODE);
  check("an owner removes the drained, empty node", removed.ok, removed.body);
  check("the node row is gone", !(await db.node.findUnique({ where: { name: NODE } })));
  check(
    "the unused token for its name is revoked, so it cannot come back by itself",
    (await db.nodeRegistrationToken.findUniqueOrThrow({ where: { id: leftover.tokenId! } })).revokedAt !== null,
  );
  check("the removal is in the audit log", Boolean(await db.activityEvent.findFirst({ where: { action: "node.removed", target: NODE } })));

  const orphaned = await fetch(`${panelUrl}/api/v1/nodes/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: NODE, token: agentToken }),
  });
  check("its agent's heartbeat, right token and all, is refused", orphaned.status === 401, String(orphaned.status));
  check("and the poller no longer has it to poll", (await pollOnce()).nodesChecked === 0);
} catch (error) {
  fail++;
  console.log(`  FAIL unexpected error: ${(error as Error).stack ?? error}`);
  if (agentOutput) console.log(`  agent said:\n${agentOutput}`);
} finally {
  agent?.kill();
  await new Promise<void>((resolve) => (panel ? panel.close(() => resolve()) : resolve()));
  await sweep();

  await docker.getImage(FIXTURE).remove({ force: true }).catch(() => {});
  if (previousFixtureId) {
    const [repo, tag] = FIXTURE.split(":") as [string, string];
    await docker.getImage(previousFixtureId).tag({ repo, tag }).catch(() => {});
  }

  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
