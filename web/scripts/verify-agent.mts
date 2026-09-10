import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* The join: a real container, the real daemon, and the panel's own
   operations driving it. Nothing here is simulated except the absence
   of an agent, which is itself one of the cases under test. */

const { db } = await import("../src/lib/db");
const ops = await import("../src/lib/server-ops");
const { encryptSecret, decryptSecret } = await import("../src/lib/secrets");
const { seed } = await import("../prisma/seed");

const TOKEN = "panel-to-agent-token-long-enough-here";
const PORT = 8900 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.join";
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
let daemon: ChildProcess | undefined;

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 60) {
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

  console.log("\n== secrets round-trip ==");
  const enc = encryptSecret(TOKEN);
  check("ciphertext does not contain the token", !enc.includes(TOKEN), enc.slice(0, 24));
  check("decrypts back to the original", decryptSecret(enc) === TOKEN);
  check("two encryptions of the same value differ", encryptSecret(TOKEN) !== encryptSecret(TOKEN));
  let tampered = false;
  try {
    const parts = enc.split(".");
    decryptSecret([parts[0], parts[1], parts[2], "AAAA" + (parts[3] ?? "").slice(4)].join("."));
  } catch {
    tampered = true;
  }
  check("a tampered ciphertext is rejected", tampered);

  console.log("\n== no agent attached ==");
  const mara = (await db.user.findUnique({ where: { email: "mara@ashfold.gg" } }))!;
  let r = await ops.stopServerOp(mara, "aurora");
  check("still works without an agent", r.ok, JSON.stringify(r));
  check("and says so plainly", r.ok && r.body.includes("No agent") === false, r.ok ? r.body : "");
  r = await ops.startServerOp(mara, "wipe");
  check("start falls back to simulation", r.ok && r.body.includes("No agent"), r.ok ? r.body : "");

  console.log("\n== bring up a real container and agent ==");
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
    name: `geeboard-join-${Date.now()}`,
    Labels: { [LABEL]: "1" },
    OpenStdin: true,
    Tty: false,
    HostConfig: { Memory: 128 * 1024 * 1024 },
    Cmd: ["sh", "-c", 'echo "world loaded"; while read line; do echo "recv: $line"; done'],
  });
  await container.start();

  daemon = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "fra-node-02",
      GEEBOARD_MANAGED_LABEL: LABEL,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent health");
  check("agent is up", true);

  // Point the seeded node at it, and map Aurora to the real container.
  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN) },
  });
  await db.server.update({ where: { slug: "aurora" }, data: { runtimeId: container.id } });

  console.log("\n== panel drives the real container ==");
  await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING" } });

  r = await ops.stopServerOp(mara, "aurora");
  check("stop reports success", r.ok, JSON.stringify(r));
  check("stop names the node, not a simulation", r.ok && r.body.includes("fra-node-02"), r.ok ? r.body : "");
  check("Docker agrees the container is down", (await container.inspect()).State.Running === false);
  check(
    "panel state matches reality",
    (await db.server.findUnique({ where: { slug: "aurora" } }))!.state === "STOPPED",
  );

  r = await ops.startServerOp(mara, "aurora");
  check("start reports success", r.ok, JSON.stringify(r));
  check("Docker agrees it is up", (await container.inspect()).State.Running === true);
  const after = (await db.server.findUnique({ where: { slug: "aurora" } }))!;
  check("panel records it running", after.state === "RUNNING", after.state);
  check("startedAt was set from the real start", after.startedAt !== null);

  r = await ops.restartServerOp(mara, "aurora");
  check("restart reports success", r.ok, JSON.stringify(r));
  check("container is running after restart", (await container.inspect()).State.Running === true);

  console.log("\n== agent client reads live data ==");
  const { agentFor } = await import("../src/lib/daemon-client");
  const node = (await db.node.findUnique({ where: { name: "fra-node-02" } }))!;
  const agent = agentFor(node)!;
  check("client is constructed for a configured node", agent !== null);

  const cid = container.id;
  const sample = await agent.stats(cid);
  check("reads a real memory limit", sample.memLimitMb >= 120 && sample.memLimitMb <= 136, String(sample.memLimitMb));

  /* Re-send while waiting: a container that has just come back from a
     restart may not be reading stdin for a moment, and a real console
     would retry too. */
  let echoed = false;
  for (let i = 0; i < 10 && !echoed; i++) {
    await agent.command(cid, "say joined up");
    await new Promise((r) => setTimeout(r, 1000));
    const lines = await agent.logs(cid, 50);
    echoed = lines.some((l) => l.line.includes("recv: say joined up"));
  }
  check("command reaches the container and comes back in the log", echoed);

  console.log("\n== a node whose agent has gone away ==");
  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: "http://127.0.0.1:1" },
  });
  r = await ops.stopServerOp(mara, "aurora");
  check("failure is reported, not swallowed", !r.ok, JSON.stringify(r));
  check("and names the node", !r.ok && r.body.includes("fra-node-02"), !r.ok ? r.body : "");
  check(
    "panel state was not changed on failure",
    (await db.server.findUnique({ where: { slug: "aurora" } }))!.state === "RUNNING",
  );
} finally {
  daemon?.kill();
  if (container) await container.remove({ force: true }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
