import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* The poller against real containers. The case that matters most is the
   one the panel cannot see coming: a server that dies without anyone
   asking it to. */

const { db } = await import("../src/lib/db");
const { pollOnce, pruneSamples } = await import("../src/lib/poller");
const { encryptSecret } = await import("../src/lib/secrets");
const { seed } = await import("../prisma/seed");

const TOKEN = "poller-token-that-is-long-enough-ok!!";
const PORT = 8700 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.poll";
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
let agent: ChildProcess | undefined;

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

const aurora = () => db.server.findUnique({ where: { slug: "aurora" } });
const events = (action: string) => db.activityEvent.count({ where: { action } });

try {
  await seed();

  console.log("\n== a workspace with no agents ==");
  let report = await pollOnce();
  check("nothing to poll is not an error", report.errors.length === 0, JSON.stringify(report.errors));
  check("no nodes checked", report.nodesChecked === 0, String(report.nodesChecked));

  console.log("\n== stand up a container and agent ==");
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
    name: `geeboard-poll-${Date.now()}`,
    Labels: { [LABEL]: "1" },
    OpenStdin: true,
    Tty: false,
    HostConfig: { Memory: 256 * 1024 * 1024 },
    /* Busy enough to register CPU, reads stdin like a server, and exits
       non-zero on command — which is how game servers actually crash. */
    Cmd: [
      "sh",
      "-c",
      'echo up; (while :; do :; done) & while read l; do [ "$l" = "crash" ] && exit 1; echo "recv: $l"; done',
    ],
  });
  await container.start();

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
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
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");

  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN), state: "HEALTHY" },
  });
  await db.server.update({
    where: { slug: "aurora" },
    data: { runtimeId: container.id, state: "RUNNING" },
  });
  await db.metricSample.deleteMany({ where: { server: { slug: "aurora" } } });

  console.log("\n== a normal pass ==");
  report = await pollOnce();
  check("the node was checked", report.nodesChecked === 1);
  check("the server was checked", report.serversChecked === 1);
  check("a sample was written", report.samplesWritten === 1, JSON.stringify(report));
  check("no errors", report.errors.length === 0, JSON.stringify(report.errors));

  const sample = (await db.metricSample.findFirst({
    where: { server: { slug: "aurora" } },
    orderBy: { at: "desc" },
  }))!;
  check("the sample holds a real memory reading", sample.ramMb > 0, String(sample.ramMb));
  check("cpu is a plausible percentage", sample.cpuPct >= 0 && sample.cpuPct <= 100, String(sample.cpuPct));

  const live = (await aurora())!;
  check("the server row took the cpu reading", live.cpuPct > 0, String(live.cpuPct));
  check("memory percent is in range", live.ramPct >= 0 && live.ramPct <= 100, String(live.ramPct));
  check("state stayed RUNNING", live.state === "RUNNING", live.state);

  const secondPass = await pollOnce();
  check("a second pass writes another sample", secondPass.samplesWritten === 1);
  check(
    "samples accumulate",
    (await db.metricSample.count({ where: { server: { slug: "aurora" } } })) === 2,
  );

  console.log("\n== a server dies without being asked ==");
  const crashesBefore = await events("server.crashed");
  /* Signals are no good here: the kernel drops unhandled signals sent to
     PID 1, and the one that does get through — SIGKILL — exits 137,
     which this system deliberately calls an ordinary stop. So crash it
     the way a game server really does, by exiting non-zero. */
  const stdin = await container.attach({ stream: true, stdin: true, hijack: true });
  (stdin as unknown as NodeJS.WritableStream).write("crash\n");
  await waitFor(async () => (await container!.inspect()).State.Running === false, "container to die");
  check(
    "the container exited with an application error code",
    (await container.inspect()).State.ExitCode === 1,
    String((await container.inspect()).State.ExitCode),
  );

  report = await pollOnce();
  const crashed = (await aurora())!;
  check("the panel notices without being told", crashed.state !== "RUNNING", crashed.state);
  check("it is recorded as a crash", crashed.state === "CRASHED", crashed.state);
  check("drift was counted", report.driftCorrected === 1, String(report.driftCorrected));
  check("a crash event was written", (await events("server.crashed")) === crashesBefore + 1);
  check("usage was zeroed", crashed.cpuPct === 0 && crashed.ramPct === 0);
  check("no sample is written for a dead container", report.samplesWritten === 0);

  const crashEvent = (await db.activityEvent.findFirst({
    where: { action: "server.crashed" },
    orderBy: { createdAt: "desc" },
  }))!;
  const changes = crashEvent.changes as Record<string, { from: string; to: string }>;
  check("the event records the transition", changes?.State?.from === "RUNNING" && changes?.State?.to === "CRASHED", JSON.stringify(changes));

  console.log("\n== and when it comes back ==");
  await container.start();
  await waitFor(async () => (await container!.inspect()).State.Running === true, "container to return");
  report = await pollOnce();
  check("the panel sees it running again", (await aurora())!.state === "RUNNING");
  check("recovery was recorded", (await events("server.recovered")) === 1);

  console.log("\n== an agent that stops answering ==");
  agent.kill();
  await new Promise((r) => setTimeout(r, 1500));
  report = await pollOnce();
  check("the node is reported unreachable", report.nodesUnreachable === 1, JSON.stringify(report));
  check("the node row says so", (await db.node.findUnique({ where: { name: "fra-node-02" } }))!.state === "UNREACHABLE");
  check("an event was written", (await events("node.unreachable")) === 1);
  check(
    "server state is left alone — the containers are probably fine",
    (await aurora())!.state === "RUNNING",
  );
  check("the failure is reported, not thrown", report.errors.length === 1, JSON.stringify(report.errors));

  console.log("\n== pruning ==");
  await db.metricSample.create({
    data: {
      serverId: (await aurora())!.id,
      at: new Date(Date.now() - 60 * 24 * 3600_000),
      cpuPct: 1,
      ramMb: 1,
      players: 0,
      tps: 20,
    },
  });
  const pruned = await pruneSamples(30);
  check("an old sample is pruned", pruned === 1, String(pruned));
  check(
    "recent samples are kept",
    (await db.metricSample.count({ where: { server: { slug: "aurora" } } })) >= 2,
  );
} finally {
  agent?.kill();
  if (container) await container.remove({ force: true }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
