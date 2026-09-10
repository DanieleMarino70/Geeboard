import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
import { SignJWT } from "jose";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* End to end: a real container writes a line, the agent streams it, the
   panel proxies it as SSE, and a client reads it — the same path a
   browser takes. Requires the panel to be built (`npm run build`). */

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");
const { encryptSecret } = await import("../src/lib/secrets");
const { classifyServerLine } = await import("../src/lib/console-fixture");
const { seed } = await import("../prisma/seed");

const TOKEN = "console-stream-token-long-enough-ok!";
const AGENT_PORT = 8800 + Math.floor(Math.random() * 90);
const PANEL_PORT = 3300 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.console";
const IMAGE = "alpine:3.20";

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
let container: Docker.Container | undefined;
let agentProc: ChildProcess | undefined;
let panelProc: ChildProcess | undefined;

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

try {
  await seed();

  console.log("\n== line classification ==");
  check("an ERROR line is levelled ERROR", classifyServerLine("[14:02] ERROR: chunk missing", false) === "ERROR");
  check("a WARN line is levelled WARN", classifyServerLine("WARN Can't keep up!", false) === "WARN");
  check("a join is levelled JOIN", classifyServerLine("thornfield joined the game", false) === "JOIN");
  check("a leave is levelled LEFT", classifyServerLine("mirefen left the game", false) === "LEFT");
  check("chat is levelled CHAT", classifyServerLine("<thornfield> hello", false) === "CHAT");
  check("a slash command is levelled CMD", classifyServerLine("/whitelist add x", false) === "CMD");
  check("stderr with no marker is an error", classifyServerLine("something broke", true) === "ERROR");
  check("plain output is INFO", classifyServerLine("Done (11.4s)!", false) === "INFO");

  console.log("\n== stand up container, agent and panel ==");
  await new Promise<void>((resolve, reject) => {
    docker.pull(IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true });
  }

  container = await docker.createContainer({
    Image: IMAGE,
    name: `geeboard-console-${Date.now()}`,
    Labels: { [LABEL]: "1" },
    OpenStdin: true,
    Tty: false,
    Cmd: ["sh", "-c", 'echo "Done (0.1s)! For help, type help"; while read l; do echo "recv: $l"; done'],
  });
  await container.start();

  agentProc = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(AGENT_PORT),
      GEEBOARD_NODE_NAME: "fra-node-02",
      GEEBOARD_MANAGED_LABEL: LABEL,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${AGENT_PORT}/health`)).ok, "agent");
  check("agent is up", true);

  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${AGENT_PORT}`, daemonToken: encryptSecret(TOKEN) },
  });
  await db.server.update({
    where: { slug: "aurora" },
    data: { runtimeId: container.id, state: "RUNNING" },
  });

  panelProc = spawn("npx", ["next", "start", "-p", String(PANEL_PORT)], {
    env: process.env,
    stdio: "ignore",
    shell: true,
  });
  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PANEL_PORT}/sign-in`);
    return res.ok;
  }, "panel");
  check("panel is up", true);

  const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
  const session = await db.session.create({
    data: { userId: mara.id, expiresAt: new Date(Date.now() + 9e5), userAgent: "verify" },
  });
  const cookie = `gb_session=${await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("900s")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))}`;

  console.log("\n== the SSE proxy ==");
  const unauth = await fetch(`http://127.0.0.1:${PANEL_PORT}/api/servers/aurora/console`);
  check("refuses an unauthenticated reader", unauth.status === 401, String(unauth.status));

  const missing = await fetch(`http://127.0.0.1:${PANEL_PORT}/api/servers/nope/console`, {
    headers: { cookie },
  });
  check("unknown server is 404", missing.status === 404, String(missing.status));

  const res = await fetch(`http://127.0.0.1:${PANEL_PORT}/api/servers/aurora/console`, {
    headers: { cookie },
  });
  check("stream opens", res.ok, String(res.status));
  check(
    "content type is an event stream",
    (res.headers.get("content-type") ?? "").includes("text/event-stream"),
    res.headers.get("content-type") ?? "",
  );

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: string[] = [];

  const readUntil = (want: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          events.push(buffer);
          if (buffer.includes(want)) {
            clearTimeout(timer);
            resolve(true);
            return;
          }
        }
        clearTimeout(timer);
        resolve(false);
      };
      void pump();
    });

  check("announces the node on open", await readUntil('event: open', 10_000));
  check("names the right node", buffer.includes("fra-node-02"), buffer.slice(0, 200));

  console.log("\n== a command travels the whole path ==");
  const sent = await ops.sendConsoleCommandOp(mara, "aurora", "say streamed hello");
  check("command accepted", sent.ok, JSON.stringify(sent));
  check("the container's reply arrives over SSE", await readUntil("recv: say streamed hello", 20_000));
  check("it arrives as a line event", buffer.includes("event: line"));

  await reader.cancel().catch(() => {});

  console.log("\n== guards ==");
  let bad = await ops.sendConsoleCommandOp(mara, "aurora", "  ");
  check("empty command refused", !bad.ok && bad.title === "Nothing to send");
  bad = await ops.sendConsoleCommandOp(mara, "aurora", "say a\nrm -rf /");
  check("multi-line command refused", !bad.ok && bad.title === "One line only");

  await db.server.update({ where: { slug: "aurora" }, data: { state: "STOPPED" } });
  bad = await ops.sendConsoleCommandOp(mara, "aurora", "say while down");
  check("command refused while the server is not running", !bad.ok && bad.title === "Server is not running", JSON.stringify(bad));
  await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING" } });

  bad = await ops.sendConsoleCommandOp(mara, "creative", "say no agent here");
  check("command refused on a node with no agent", !bad.ok && bad.title === "No agent on this node", JSON.stringify(bad));

  console.log("\n== commands are audited ==");
  const audited = await db.activityEvent.count({ where: { action: "console.command" } });
  check("the sent command was recorded", audited === 1, String(audited));
} finally {
  agentProc?.kill();
  panelProc?.kill();
  if (container) await container.remove({ force: true }).catch(() => {});
  await db.session.deleteMany({ where: { userAgent: "verify" } }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
