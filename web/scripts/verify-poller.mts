import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* The poller against real containers. The case that matters most is the
   one the panel cannot see coming: a server that dies without anyone
   asking it to. */

const { db } = await import("../src/lib/db");
const { pollOnce, pruneSamples, pruneSessions, sweepInterruptedCreates } = await import("../src/lib/poller");
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

/* Tell the stand-in to crash, through the agent's console route — the
   one the panel uses. This used to write to the container with
   dockerode's attach, which puts its own options object on stdin ahead
   of the line: the stand-in read `{"stream":true,…}crash`, did not
   recognise it, and the script timed out waiting for a crash that was
   never asked for. Whenever the object happened to arrive as a line of
   its own, it passed — which is why this check came and went. */
async function tell(command: string, id = container!.id) {
  const response = await fetch(`http://127.0.0.1:${PORT}/servers/${id}/command`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ command }),
  });
  if (!response.ok) throw new Error(`the agent refused the command: ${response.status}`);
}
const crash = () => tell("crash");

/* The stand-in, as a container: reads stdin like a server, crashes on "crash" and exits 0 on "quit", which is what a
   game does when it is asked to stop by Docker's SIGTERM or by a player typing /stop. */
const STAND_IN = 'echo up; (while :; do :; done) & while read l; do [ "$l" = "crash" ] && exit 1; [ "$l" = "quit" ] && exit 0; echo "recv: $l"; done';

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
      STAND_IN,
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

  /* A container read in its first moments has no memory statistics yet,
     and the poller declines to record that as 0 MB — so wait, as a real
     server would be read. Until a *megabyte*, not merely until the engine
     reports at all: a stand-in is a shell in a loop and uses almost
     nothing, `memUsedMb` is rounded, and `measured: true` with 400 KB in
     use is a sample of 0 MB — which is what made the check below fail now
     and then on a reading that was perfectly correct. */
  await waitFor(async () => {
    const stats = await fetch(`http://127.0.0.1:${PORT}/servers/${container!.id}/stats`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const sample = (await stats.json()) as { measured?: boolean; memUsedMb?: number };
    return sample.measured === true && (sample.memUsedMb ?? 0) > 0;
  }, "the engine to have measured a megabyte of the container");

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

  const live = (await aurora())!;
  /* Percent of one core, as `docker stats` reports it and as a server's
     CPU limit is set — so a busy container on a multi-core node reads
     above 100, and this check used to fail whenever the machine was busy
     enough for the stand-in to spill onto a second core. The ceiling is
     the server's own limit, with room for the jitter of one sample. */
  check(
    "cpu is a plausible percentage",
    sample.cpuPct >= 0 && sample.cpuPct <= live.cpuLimit * 1.1,
    `${sample.cpuPct} of a ${live.cpuLimit}% limit`,
  );
  check("the server row took the cpu reading", live.cpuPct > 0, String(live.cpuPct));
  check("memory percent is in range", live.ramPct >= 0 && live.ramPct <= 100, String(live.ramPct));
  check("state stayed RUNNING", live.state === "RUNNING", live.state);

  const secondPass = await pollOnce();
  check("a second pass writes another sample", secondPass.samplesWritten === 1);
  check(
    "samples accumulate",
    (await db.metricSample.count({ where: { server: { slug: "aurora" } } })) === 2,
  );

  console.log("\n== the network, between samples ==");
  const sampled = await db.metricSample.findMany({ where: { server: { slug: "aurora" } }, orderBy: { at: "asc" } });
  check("the first sample of a run has no network difference to give", sampled[0]!.rxBytes === null && sampled[0]!.txBytes === null);
  check(
    "the second has one, and it is not negative",
    sampled[1]!.rxBytes !== null && sampled[1]!.txBytes !== null && sampled[1]!.rxBytes >= BigInt(0) && sampled[1]!.txBytes >= BigInt(0),
    `${sampled[1]!.rxBytes} ${sampled[1]!.txBytes}`,
  );
  const based = (await aurora())!;
  check("the server keeps the counters it last read, and the run they belong to", based.netRx !== null && based.netTx !== null && based.netStartedAt !== null);
  /* Docker's counters start again with the container. A base far above anything they can read now is what a
     restart looks like from the panel's side: the amount is then what has gone through since, and never a
     negative number or a difference of two runs. */
  await db.server.update({ where: { slug: "aurora" }, data: { netRx: BigInt(40_000_000_000), netTx: BigInt(40_000_000_000) } });
  const afterReset = await pollOnce();
  const reset = (await db.metricSample.findFirst({ where: { server: { slug: "aurora" } }, orderBy: { at: "desc" } }))!;
  check(
    "a counter that went down is a restart: the sample holds what went through since, not a huge or a negative amount",
    afterReset.samplesWritten === 1 && reset.rxBytes !== null && reset.rxBytes >= BigInt(0) && reset.rxBytes < BigInt(50_000_000) && reset.txBytes !== null && reset.txBytes >= BigInt(0) && reset.txBytes < BigInt(50_000_000),
    `${reset.rxBytes} ${reset.txBytes}`,
  );
  check("and the base is the new run's, so the next difference is taken from it", ((await aurora())!.netRx ?? BigInt(0)) < BigInt(50_000_000));

  console.log("\n== the node's history ==");
  const nodeSamples = await db.nodeSample.findMany({ where: { node: { name: "fra-node-02" } }, orderBy: { at: "asc" } });
  check("each pass that reaches a node writes one sample of it", nodeSamples.length === 3, String(nodeSamples.length));
  check("holding what the node last reported, and the round trip", nodeSamples.every((n) => n.cpuPct >= 0 && n.ramPct >= 0 && n.diskPct >= 0 && n.pingMs >= 1), JSON.stringify(nodeSamples[0]));
  check("a node with no agent has none", (await db.nodeSample.count({ where: { node: { name: "ash-node-01" } } })) === 0);

  console.log("\n== a server dies without being asked ==");
  /* Automatic restart off for this half: what is under test here is
     whether the panel *notices*, and a server that recovery has already
     put back into STARTING cannot answer that question. Recovery gets
     its own section below. */
  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "NEVER" } });
  const crashesBefore = await events("server.crashed");
  /* Signals are no good here: the kernel drops unhandled signals sent to
     PID 1, and the one that does get through — SIGKILL — exits 137,
     which this system deliberately calls an ordinary stop. So crash it
     the way a game server really does, by exiting non-zero. */
  await crash();
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
  check("recovery was recorded", (await events("server.recovered")) >= 1);

  console.log("\n== crash recovery puts it back on its own ==");
  await db.server.update({
    where: { slug: "aurora" },
    data: { restartPolicy: "ON_FAILURE", maxRestarts: 3, restartAttempts: 0, lastRestartAt: null },
  });

  await crash();
  await waitFor(async () => (await container!.inspect()).State.Running === false, "container to die again");

  report = await pollOnce();
  const recovered = (await aurora())!;
  check("the panel restarted it without being asked", report.recovered === 1, JSON.stringify(report));
  check("and it is running again", (await container.inspect()).State.Running === true);
  check("the state moved on from crashed", recovered.state === "STARTING", recovered.state);
  check("the attempt was counted", recovered.restartAttempts === 1, String(recovered.restartAttempts));
  check("the crash was counted too", recovered.crashCount >= 1, String(recovered.crashCount));

  /* The ceiling. A server that has used its attempts stops being
     retried and says so, rather than being restarted all night. */
  await db.server.update({
    where: { slug: "aurora" },
    data: { restartAttempts: 3, maxRestarts: 3, lastRestartAt: new Date(Date.now() - 3600_000) },
  });
  await crash();
  await waitFor(async () => (await container!.inspect()).State.Running === false, "container to die again");

  report = await pollOnce();
  const abandoned = (await aurora())!;
  check("past the ceiling it gives up", report.gaveUp === 1, JSON.stringify(report));
  check("and says so rather than retrying", abandoned.state === "ERROR", abandoned.state);
  check("with a reason a person can act on", (abandoned.lastError ?? "").includes("crashed"), String(abandoned.lastError));
  check("it was not restarted", (await container.inspect()).State.Running === false);

  // Back to a sane state for the sections below.
  await db.server.update({
    where: { slug: "aurora" },
    data: { restartPolicy: "NEVER", restartAttempts: 0, state: "RUNNING", lastError: null },
  });
  await container.start();
  await waitFor(async () => (await container!.inspect()).State.Running === true, "container to return");
  await pollOnce();

  console.log("\n== the machine stops a server it was running ==");
  /* A reboot, or Docker restarting, ends a container with a signal. SIGKILL is the one that reaches PID 1 here (see
     the crash above), and it exits 137, which the agent reads as an ordinary stop. Before 0.9 nothing started such a
     server again, whatever its restart policy said. */
  const kill = async () => {
    await container!.kill();
    await waitFor(async () => (await container!.inspect()).State.Running === false, "container to be stopped from outside");
  };
  const back = async () => {
    // The panel may have started it already, which is what is being tested.
    if (!(await container!.inspect()).State.Running) await container!.start();
    await waitFor(async () => (await container!.inspect()).State.Running === true, "container to return");
    await db.server.update({ where: { slug: "aurora" }, data: { state: "RUNNING", lastError: null, restartAttempts: 0, lastRestartAt: null } });
    await pollOnce();
  };

  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "ALWAYS", maxRestarts: 3, restartAttempts: 0, lastRestartAt: null } });
  const recoveredBefore = await events("server.recovered");
  await kill();
  check("the container exited with 137", (await container.inspect()).State.ExitCode === 137, String((await container.inspect()).State.ExitCode));
  report = await pollOnce();
  const restarted = (await aurora())!;
  check("under always the panel starts it again, on the pass that saw it stop", report.recovered === 1 && (await container.inspect()).State.Running === true, JSON.stringify(report));
  check("it is starting, and the machine's doing does not use up the crash budget", restarted.state === "STARTING" && restarted.restartAttempts === 0, `${restarted.state} ${restarted.restartAttempts}`);
  const recoveredRow = (await db.activityEvent.findFirst({ where: { action: "server.recovered" }, orderBy: { createdAt: "desc" } }))!;
  const recoveredChanges = recoveredRow.changes as Record<string, { to: string }>;
  check("recorded as a recovery, with why", (await events("server.recovered")) === recoveredBefore + 1 && /^Docker or the machine stopped it; its policy is to restart whenever it stops/.test(recoveredChanges?.Reason?.to ?? ""), JSON.stringify(recoveredChanges));
  check("and it was not called a crash", (await db.server.findUniqueOrThrow({ where: { slug: "aurora" } })).crashCount === restarted.crashCount);
  await back();

  /* Its own stop is not undone: a person pressed Stop, and the panel set STOPPING before it asked the node. */
  await db.server.update({ where: { slug: "aurora" }, data: { state: "STOPPING" } });
  await kill();
  report = await pollOnce();
  const stopped = (await aurora())!;
  check("a stop the panel issued stays a stop under always", stopped.state === "STOPPED" && report.recovered === 0 && (await container.inspect()).State.Running === false, `${stopped.state} ${JSON.stringify(report)}`);
  report = await pollOnce();
  check("and stays one on the next pass", (await aurora())!.state === "STOPPED" && report.recovered === 0);
  await back();

  /* The other two policies leave it stopped, and the page says why: here a signal ended it, which is evidence. */
  for (const policy of ["ON_FAILURE", "NEVER"] as const) {
    await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: policy, restartAttempts: 0 } });
    const hostBefore = await events("server.left.stopped");
    await kill();
    report = await pollOnce();
    const left = (await aurora())!;
    check(`under ${policy} it is left stopped`, left.state === "STOPPED" && report.recovered === 0 && (await container.inspect()).State.Running === false, `${left.state} ${JSON.stringify(report)}`);
    check(`with the reason on its page`, /^Docker or the machine stopped it/.test(left.lastError ?? "") && /left stopped/.test(left.lastError ?? "") && /Start it from this page/.test(left.lastError ?? ""), String(left.lastError));
    check(`and in the audit log, once`, (await events("server.left.stopped")) === hostBefore + 1);
    await pollOnce();
    check(`not again on the next pass`, (await events("server.left.stopped")) === hostBefore + 1);
    await back();
  }

  /* Measured on a real machine: a Minecraft server that Docker stops exits 0, the same as the game quitting by itself.
     Alone, the panel says it does not know why, and does not say the machine did it. */
  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "ON_FAILURE", restartAttempts: 0 } });
  const quietBefore = await events("server.left.stopped");
  await tell("quit");
  await waitFor(async () => (await container!.inspect()).State.Running === false, "container to quit");
  check("it exited 0, as a game does", (await container.inspect()).State.ExitCode === 0, String((await container.inspect()).State.ExitCode));
  report = await pollOnce();
  const quit = (await aurora())!;
  check("a clean exit nobody asked for is left stopped under on-failure", quit.state === "STOPPED" && report.recovered === 0, `${quit.state} ${JSON.stringify(report)}`);
  check("its page says nothing is known about why, and does not blame the machine", /^The panel did not stop it and nothing says why/.test(quit.lastError ?? "") && !/Docker or the machine stopped it/.test(quit.lastError ?? ""), String(quit.lastError));
  check("and the audit log has the row that becomes a message", (await events("server.left.stopped")) === quietBefore + 1);
  await back();

  /* With another server of the node stopped in the same pass, what a restart looks like. A second stand-in, as a server. */
  const twinContainer = await docker.createContainer({
    Image: IMAGE,
    name: `geeboard-poll-twin-${Date.now()}`,
    Labels: { [LABEL]: "1" },
    OpenStdin: true,
    Tty: false,
    HostConfig: { Memory: 256 * 1024 * 1024 },
    Cmd: ["sh", "-c", STAND_IN],
  });
  await twinContainer.start();
  const twinRow: Record<string, unknown> = { ...(await aurora())! };
  for (const own of ["id", "createdAt", "updatedAt"]) delete twinRow[own];
  const twin = await db.server.create({
    data: { ...twinRow, slug: "twin", name: "Twin", host: "twin.ashfold.gg", port: 29999, runtimeId: twinContainer.id, state: "RUNNING", restartPolicy: "NEVER", lastError: null, installKey: null } as never,
  });
  try {
    await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "ON_FAILURE" } });
    await tell("quit");
    await tell("quit", twinContainer.id);
    await waitFor(async () => (await container!.inspect()).State.Running === false && (await twinContainer.inspect()).State.Running === false, "both to quit");
    const togetherBefore = await events("server.left.stopped");
    report = await pollOnce();
    const both = [(await aurora())!, (await db.server.findUniqueOrThrow({ where: { slug: "twin" } }))];
    check("two servers of a node stopped in one pass are both left stopped, one row each", both.every((s) => s.state === "STOPPED") && (await events("server.left.stopped")) === togetherBefore + 2, both.map((s) => s.state).join());
    check("each says it stopped with the other, on that node, and that this points at the machine", both.every((s) => /^It stopped together with 1 other server on fra-node-02, which points at the machine or Docker restarting\./.test(s.lastError ?? "")), both.map((s) => s.lastError).join(" | "));
    check("and neither is told it was the machine", both.every((s) => !/^Docker or the machine stopped it/.test(s.lastError ?? "")));
  } finally {
    await twinContainer.remove({ force: true });
    await db.server.deleteMany({ where: { id: twin.id } });
  }
  await back();

  /* The budget is for a game that stops the moment it starts: with nothing to say why, a second stop in a row is
     delayed, and a later pass takes it up. A signal at the ceiling is still started, as the machine's doing. */
  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "ALWAYS", restartAttempts: 3, lastRestartAt: new Date() } });
  await kill();
  report = await pollOnce();
  const past = (await aurora())!;
  check("a signal at the ceiling, inside the delay, is still started: it is not a loop", report.recovered === 1 && past.restartAttempts === 3 && (await container.inspect()).State.Running === true, `${past.state} ${past.restartAttempts} ${JSON.stringify(report)}`);
  await back();
  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "ALWAYS", restartAttempts: 1, lastRestartAt: new Date() } });
  await tell("quit");
  await waitFor(async () => (await container!.inspect()).State.Running === false, "container to quit");
  report = await pollOnce();
  const waiting = (await aurora())!;
  check("a second stop in a row waits its delay and says so", waiting.state === "STOPPED" && report.recovered === 0 && (waiting.lastError ?? "").startsWith("Stopped without the panel asking"), `${waiting.state} ${waiting.lastError}`);
  await db.server.update({ where: { slug: "aurora" }, data: { lastRestartAt: new Date(Date.now() - 3600_000) } });
  report = await pollOnce();
  check("and the pass after it is due starts it", report.recovered === 1 && (await container.inspect()).State.Running === true && (await aurora())!.lastError === null, JSON.stringify(report));
  await back();
  await db.server.update({ where: { slug: "aurora" }, data: { restartPolicy: "NEVER" } });

  console.log("\n== an agent that stops answering ==");
  agent.kill();
  await new Promise((r) => setTimeout(r, 1500));

  const node = () => db.node.findUnique({ where: { name: "fra-node-02" } });

  /* One failed request is not a dead machine. A dropped packet, a
     restarting agent and a real outage all look identical from here,
     and only one of them is worth an alarm — so health decays from
     silence rather than flipping on the first failure. */
  report = await pollOnce();
  check("the failure is reported", report.nodesUnreachable === 1, JSON.stringify(report));
  check("but one failure is not an outage", (await node())!.state === "HEALTHY", (await node())!.state);
  check("and nothing was written about it", (await events("node.unreachable")) === 0);

  /* Two minutes of silence is a different claim, and this is it. Both
     timestamps, because they are different claims too: heard from at
     all, and reached on its own address. Health decays from the second
     — see domain/nodes/health.ts. */
  await db.node.update({
    where: { name: "fra-node-02" },
    data: { lastSeenAt: new Date(Date.now() - 5 * 60_000), lastReachedAt: new Date(Date.now() - 5 * 60_000) },
  });
  report = await pollOnce();
  check("silence for long enough is an outage", (await node())!.state === "UNREACHABLE", (await node())!.state);
  check("an event was written", (await events("node.unreachable")) === 1);
  check(
    "server state is left alone — the containers are probably fine",
    (await aurora())!.state === "RUNNING",
  );
  check("the failure is reported, not thrown", report.errors.length === 1, JSON.stringify(report.errors));

  console.log("\n== a create the panel did not live to finish ==");
  /* The panel is stopped in the middle of a create: the row says INSTALLING,
     has no workload, and nothing will write it again. The poller reads only
     servers that have a workload, so it never looked at such a row. */
  type CreateData = Parameters<typeof db.server.create>[0]["data"];
  const model = (await aurora())!;
  const copy: Record<string, unknown> = { ...model };
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  const stuck = async (slug: string, state: "INSTALLING" | "CREATING" | "RUNNING", age: number, step: string | null, port: number) =>
    db.server.create({
      data: {
        ...copy,
        slug,
        name: `Stuck ${slug}`,
        host: `${slug}.ashfold.gg`,
        port,
        state,
        runtimeId: null,
        installKey: step ? `${slug}-key-0123456789` : null,
        installStep: step,
        installMessage: step ? "Downloading" : null,
        updatedAt: minutesAgo(age),
      } as unknown as CreateData,
    });
  await stuck("quiet-eleven", "INSTALLING", 11, "download", model.port + 101);
  await stuck("quiet-nine", "INSTALLING", 9, "download", model.port + 102);
  await stuck("quiet-creating", "CREATING", 30, null, model.port + 103);
  await stuck("quiet-running", "RUNNING", 180, null, model.port + 104);
  const row = (slug: string) => db.server.findUniqueOrThrow({ where: { slug } });

  const swept = await sweepInterruptedCreates();
  check("two creates quiet for over ten minutes are swept", swept === 2, String(swept));
  const eleven = await row("quiet-eleven");
  check("an INSTALLING one becomes an error", eleven.state === "ERROR", eleven.state);
  check("that says where it had got to and what to do", /which was downloading its build/.test(eleven.lastError ?? "") && /Delete it from its Settings page/.test(eleven.lastError ?? ""), eleven.lastError ?? "");
  check("and loses its progress, which nobody is waiting on", eleven.installKey === null && eleven.installStep === null && eleven.installMessage === null);
  check("a CREATING one too", (await row("quiet-creating")).state === "ERROR");
  check("one that wrote nine minutes ago is left alone", (await row("quiet-nine")).state === "INSTALLING");
  check("a server that is simply running is none of it", (await row("quiet-running")).state === "RUNNING");
  const interrupted = await db.activityEvent.findMany({ where: { action: "server.create.interrupted" }, orderBy: { createdAt: "asc" } });
  check("each is written into the audit log, by the watchdog, as a warning", interrupted.length === 2 && interrupted.every((e) => e.actor === "Watchdog" && e.tone === "WARNING" && e.serverId !== null), JSON.stringify(interrupted.map((e) => [e.actor, e.tone])));
  check("with where it was and where it is now", JSON.stringify(interrupted[0]?.changes).includes("INSTALLING") && JSON.stringify(interrupted[0]?.changes).includes("ERROR"), JSON.stringify(interrupted[0]?.changes));
  check("a second pass finds nothing more and writes nothing more", (await sweepInterruptedCreates()) === 0 && (await db.activityEvent.count({ where: { action: "server.create.interrupted" } })) === 2);
  // Nine minutes becomes eleven: the same sweep takes it, by the same rule.
  await db.server.update({ where: { slug: "quiet-nine" }, data: { updatedAt: minutesAgo(11) } });
  check("and one that goes on being quiet is swept when it passes ten minutes", (await sweepInterruptedCreates()) === 1 && (await row("quiet-nine")).state === "ERROR");
  await db.server.create({
    data: { ...copy, slug: "quiet-poller", name: "Stuck quiet-poller", host: "quiet-poller.ashfold.gg", port: model.port + 105, state: "INSTALLING", runtimeId: null, installStep: "provision", updatedAt: minutesAgo(12) } as unknown as CreateData,
  });
  const pass = await pollOnce();
  check("a pass of the poller does it, and reports it", pass.interruptedCreates === 1 && (await row("quiet-poller")).state === "ERROR", JSON.stringify({ interrupted: pass.interruptedCreates }));

  console.log("\n== pruning ==");
  await db.metricSample.create({
    data: {
      serverId: (await aurora())!.id,
      at: new Date(Date.now() - 60 * 24 * 3600_000),
      cpuPct: 1,
      ramMb: 1,
      players: 0,
    },
  });
  const pruned = await pruneSamples(30);
  check("an old sample is pruned", pruned === 1, String(pruned));
  check(
    "recent samples are kept",
    (await db.metricSample.count({ where: { server: { slug: "aurora" } } })) >= 2,
  );

  console.log("\n== sessions that have expired ==");
  /* Nothing removed them: the only deletions were a person signing out, changing
     a password or ending their sessions. A row per sign-in, for ever, and the
     Members page counted the dead ones beside the live. */
  const tomas = await db.user.findUniqueOrThrow({ where: { email: "tomas@ashfold.gg" } });
  const hoursFrom = (n: number) => new Date(Date.now() + n * 3600_000);
  await db.session.deleteMany({ where: { userId: tomas.id } });
  await db.session.create({ data: { userId: tomas.id, expiresAt: hoursFrom(-48), userAgent: "expired long ago" } });
  await db.session.create({ data: { userId: tomas.id, expiresAt: hoursFrom(-0.01), userAgent: "expired a moment ago" } });
  await db.session.create({ data: { userId: tomas.id, expiresAt: hoursFrom(1), userAgent: "still good" } });
  await db.session.create({ data: { userId: tomas.id, expiresAt: hoursFrom(24 * 13), userAgent: "a fresh sign-in" } });
  const { getMembers } = await import("../src/lib/queries");
  const before = (await getMembers()).find((m) => m.id === tomas.id);
  check("the Members page counts the live sessions and not the expired", before?.sessions === 2, String(before?.sessions));
  const gone = await pruneSessions();
  check("the expired ones are pruned, however long or short ago", gone === 2, String(gone));
  const left = await db.session.findMany({ where: { userId: tomas.id }, select: { userAgent: true } });
  check("and the live ones are left", left.map((s) => s.userAgent).sort().join() === "a fresh sign-in,still good", left.map((s) => s.userAgent).join());
  check("a second pass finds nothing", (await pruneSessions()) === 0);
} finally {
  agent?.kill();
  if (container) await container.remove({ force: true }).catch(() => {});
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
