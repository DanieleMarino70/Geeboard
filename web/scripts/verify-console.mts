import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
import { SignJWT } from "jose";
import { startPanel, stopPanel, waitForPanel, type Panel } from "./verify-panel.mts";

/* End to end: a real container writes a line, the agent streams it, the
   panel proxies it as SSE, and a client reads it — the same path a
   browser takes. Needs Postgres and Docker, and nothing built: it starts
   a development server of its own (see the panel spawn, below). */

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");
const { encryptSecret } = await import("../src/lib/secrets");
const { classifyServerLine } = await import("../src/lib/console-fixture");
const { STREAM_RECHECK_MS } = await import("../src/domain/access/streams");
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
let panelProc: Panel | undefined;

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

  /* The development server, not `next start`, for two reasons found the
     first time this was run from a fresh clone rather than from the
     machine it was written on.

     `next start` serves a build. There was always one lying around here,
     so for months this passed; in a clone with no .next it exited at
     once and the wait below ended in "timed out waiting for panel",
     which tells nobody anything.

     And `next start` runs in production, where the panel now refuses a
     `DATABASE_URL` still on the development password — a gate that is
     right, and that no check running against the development database
     can ever get past. Weakening it for a verify run would be trading a
     real protection for a green line.

     What this file is about is the path a console line takes: container,
     agent, panel, SSE, client. The development server serves the same
     route. Its own build directory, so a developer's `npm run dev` and
     this can both be up. Same choice as verify-setup.mts. */
  panelProc = startPanel(PANEL_PORT, { ...process.env, GEEBOARD_DIST_DIR: ".next-console" });
  await waitForPanel(panelProc, `http://127.0.0.1:${PANEL_PORT}`);
  check("panel is up", true);

  /* A session row and the cookie that points at it, as signing in makes. */
  const sessionFor = async (userId: string) => {
    const session = await db.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 9e5), userAgent: "verify" },
    });
    const jwt = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("900s")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    return { id: session.id, cookie: `gb_session=${jwt}` };
  };

  const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
  const devi = (await db.user.findUnique({ where: { email: "devi@ashfold.gg" } }))!;
  const tomas = (await db.user.findUnique({ where: { email: "tomas@ashfold.gg" } }))!;
  /* The stream asks the account gate now, as every page does, and nobody
     in the seed has enrolled two-factor: the admin reads the console here
     as one who has. Only this database is touched, and the seed at the
     end puts it back. */
  await db.user.update({ where: { id: devi.id }, data: { twoFactor: true } });
  const admin = await sessionFor(devi.id);
  const cookie = admin.cookie;

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

  /* The pages, not only the matrix. Until September 2026 the console page
     and the last lines on a server's page read the node for anyone signed
     in, while the stream refused them: a member read every console. The
     container's first line is the marker — it is in any page that shows
     the backlog, and in none that must not. */
  console.log("\n== who may read a console ==");
  const LINE = "Done (0.1s)! For help, type help";
  const base = `http://127.0.0.1:${PANEL_PORT}`;
  const page = async (path: string, as: string) => {
    const res = await fetch(`${base}${path}`, { headers: { cookie: as }, redirect: "manual" });
    return { status: res.status, html: await res.text() };
  };
  const streamStatus = async (slug: string, as: string) => {
    const res = await fetch(`${base}/api/servers/${slug}/console`, { headers: { cookie: as } });
    await res.body?.cancel().catch(() => {});
    return res.status;
  };

  const owner = await sessionFor(mara.id);
  const ownerStream = await streamStatus("aurora", owner.cookie);
  check("an owner without two-factor is refused the stream, as every page refuses them", ownerStream === 403, String(ownerStream));

  // A member of their own, rather than a role changed on somebody in the seed.
  const petra = await db.user.create({
    data: {
      email: "petra@verify.invalid",
      name: "Petra Member",
      initials: "PM",
      role: "MEMBER",
      passwordHash: "not-a-hash",
      passwordSetAt: new Date(),
    },
  });
  await db.server.update({
    where: { slug: "wipe" },
    data: { ownerId: petra.id, runtimeId: container.id, state: "RUNNING" },
  });
  const member = await sessionFor(petra.id);

  const othersStream = await streamStatus("aurora", member.cookie);
  check("a member is refused the stream of a server that is not theirs", othersStream === 403, String(othersStream));
  const othersConsole = await page("/console?server=aurora", member.cookie);
  check(
    "a member's console page for somebody else's server says why, and shows no line",
    othersConsole.status === 200 && othersConsole.html.includes("No console access") && !othersConsole.html.includes(LINE),
    `${othersConsole.status} marker=${othersConsole.html.includes(LINE)}`,
  );
  const othersOverview = await page("/servers/aurora", member.cookie);
  check(
    "a member's page for somebody else's server shows no last lines, and says why",
    othersOverview.status === 200 &&
      othersOverview.html.includes("Its console is open to the server") &&
      !othersOverview.html.includes(LINE),
    `${othersOverview.status} marker=${othersOverview.html.includes(LINE)}`,
  );

  const ownConsole = await page("/console?server=wipe", member.cookie);
  check("a member reads their own server's console", ownConsole.status === 200 && ownConsole.html.includes(LINE), String(ownConsole.status));
  const ownOverview = await page("/servers/wipe", member.cookie);
  check("and its last lines", ownOverview.status === 200 && ownOverview.html.includes(LINE), String(ownOverview.status));
  const ownStream = await streamStatus("wipe", member.cookie);
  check("and its stream", ownStream === 200, String(ownStream));

  const moderator = await sessionFor(tomas.id);
  const watched = await page("/console?server=aurora", moderator.cookie);
  check("a moderator reads anybody's console", watched.status === 200 && watched.html.includes(LINE), String(watched.status));

  /* Authorised while it runs, not only when it opened. Each is closed
     within STREAM_RECHECK_MS, with the reason as its last event. */
  console.log("\n== an open console is asked again ==");
  const follow = (res: Response) => {
    const body = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let ended = false;
    const until = (want: string, ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        void (async () => {
          while (!ended && !text.includes(want)) {
            const chunk = await body.read().catch(() => ({ done: true, value: undefined }));
            if (chunk.done) ended = true;
            else text += decoder.decode(chunk.value, { stream: true });
          }
          clearTimeout(timer);
          resolve(text.includes(want));
        })();
      });
    return { until, text: () => text, closed: () => ended, cancel: () => body.cancel().catch(() => {}) };
  };
  const open = async (slug: string, as: string) => {
    const stream = follow(await fetch(`${base}/api/servers/${slug}/console`, { headers: { cookie: as } }));
    return { stream, opened: await stream.until("event: open", 10_000) };
  };
  const within = STREAM_RECHECK_MS + 10_000;

  const byRole = await open("aurora", moderator.cookie);
  check("a moderator's console on somebody else's server opens", byRole.opened);
  await db.user.update({ where: { id: tomas.id }, data: { role: "MEMBER" } });
  check(
    "a role taken away closes it, saying why",
    (await byRole.stream.until("event: ended", within)) && byRole.stream.text().includes("Your role is now member"),
    byRole.stream.text().slice(-240),
  );
  await byRole.stream.until("event: never", 5_000);
  check("and the stream ends there", byRole.stream.closed());

  const byOwner = await open("wipe", member.cookie);
  check("a member's console on their own server opens", byOwner.opened);
  await db.server.update({ where: { slug: "wipe" }, data: { ownerId: mara.id } });
  check(
    "the server given to somebody else closes it",
    (await byOwner.stream.until("event: ended", within)) && byOwner.stream.text().includes("given to somebody else"),
    byOwner.stream.text().slice(-240),
  );

  const bySession = await open("aurora", admin.cookie);
  check("an admin's console opens", bySession.opened);
  await db.session.delete({ where: { id: admin.id } });
  check(
    "a session ended from the account page closes it",
    (await bySession.stream.until("event: ended", within)) && bySession.stream.text().includes("You were signed out"),
    bySession.stream.text().slice(-240),
  );
  for (const s of [byRole.stream, byOwner.stream, bySession.stream]) await s.cancel();
} finally {
  agentProc?.kill();
  stopPanel(panelProc);
  if (container) await container.remove({ force: true }).catch(() => {});
  await db.session.deleteMany({ where: { userAgent: "verify" } }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
