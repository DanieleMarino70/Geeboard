import "./load-env.mts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";

/* The poller's pass and the scheduler's tasks against stand-in agents on this machine and a real Postgres. No Docker: what is measured is the
   panel's own work: how long a pass is for a hundred servers on ten nodes, what one node that does not answer or cannot be opened costs the
   others, and that a night of backups no longer stops the watch. The stand-ins answer after a delay that can be set from the environment:

     POLLSCALE_LATENCY_MS   every call, default 30 (a node on the same continent)
     POLLSCALE_STATS_MS     the stats call alone, default the same (Docker's own two-frame answer was 2000 on a 6-core VPS: P21's measurement)
     POLLSCALE_NODES        nodes in the scale run, default 10
     POLLSCALE_SERVERS      servers on each, default 10 */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
await seed();
const { pollOnce } = await import("../src/lib/poller");
const { runDueTasks } = await import("../src/lib/scheduler");
const { checkSealedSecrets } = await import("../src/lib/sealed-check");
const { describeSealed } = await import("../src/domain/sealed");
const { encryptSecret, sealWith } = await import("../src/lib/secrets");
const { SECRETS_KEY_SENTENCE } = await import("../src/domain/errors");

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN = "pollscale-token-that-is-long-enough-ok!!";
const OTHER_KEY = "another-secrets-key-that-is-long-enough-0123456789";
const LATENCY = Number(process.env.POLLSCALE_LATENCY_MS ?? 30);
const STATS = Number(process.env.POLLSCALE_STATS_MS ?? LATENCY);

/* ── A stand-in agent ─────────────────────────────────────────────── */

interface Stub {
  url: string;
  calls: Record<string, number>;
  /** Calls of each kind in flight at the same moment, at most. */
  peak: Record<string, number>;
  close(): Promise<void>;
}
interface StubOptions {
  latency?: number;
  statsMs?: number;
  /** Per kind of call, instead of the latency. */
  delay?: Record<string, number>;
  /** Never answers anything. */
  silent?: boolean;
  /** Runs when a call of this kind arrives, before its delay. */
  hook?: (kind: string, serverId: string) => Promise<void>;
}
const open: Stub[] = [];
/* Calls of each kind in flight over every stand-in at once, and the most there were since it was last reset: what the gate lets through. */
const liveNow: Record<string, number> = {};
const livePeak: Record<string, number> = {};
const resetLive = () => {
  for (const key of Object.keys(livePeak)) livePeak[key] = 0;
};

async function stub(options: StubOptions = {}): Promise<Stub> {
  const calls: Record<string, number> = {};
  const inflight: Record<string, number> = {};
  const peak: Record<string, number> = {};
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (options.silent) return;
    const path = (req.url ?? "").split("?")[0]!;
    const m = /^\/servers\/([^/]+)(?:\/(.*))?$/.exec(path);
    const kind = path === "/health" ? "health" : m ? ({ "": "status", stats: "stats", probe: "probe", "probe/exchange": "exchange", logs: "logs", usage: "usage", command: "command" } as Record<string, string>)[m[2] ?? ""] : undefined;
    if (!kind) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no such route" }));
      return;
    }
    calls[kind] = (calls[kind] ?? 0) + 1;
    inflight[kind] = (inflight[kind] ?? 0) + 1;
    peak[kind] = Math.max(peak[kind] ?? 0, inflight[kind]!);
    liveNow[kind] = (liveNow[kind] ?? 0) + 1;
    livePeak[kind] = Math.max(livePeak[kind] ?? 0, liveNow[kind]!);
    try {
      await options.hook?.(kind, m?.[1] ?? "");
      await sleep(options.delay?.[kind] ?? (kind === "stats" ? (options.statsMs ?? options.latency ?? 0) : (options.latency ?? 0)));
    } finally {
      inflight[kind]!--;
      liveNow[kind]!--;
    }
    const body =
      kind === "health"
        ? { ok: true }
        : kind === "status"
          ? { id: m![1], name: "stub", state: "running", exitCode: null, startedAt: new Date(Date.now() - 5_000).toISOString(), image: "stub" }
          : kind === "stats"
            ? { cpuPct: 12, memUsedMb: 900, memLimitMb: 2048, memPct: 44, rxBytes: 1000, txBytes: 2000, measured: true }
            : kind === "probe"
              ? { reachable: true, ms: 1 }
              : kind === "exchange"
                ? { reply: "", bytes: 0, ended: "timeout", ms: 1 }
                : kind === "logs"
                  ? { lines: [] }
                  : kind === "usage"
                    ? { bytes: 1_000_000, files: 10 }
                    : { ok: true };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const http = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const one: Stub = {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    calls,
    peak,
    close: async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
  open.push(one);
  return one;
}

/* ── Rows ─────────────────────────────────────────────────────────── */

const template = await db.server.findUniqueOrThrow({ where: { slug: "aurora" } });
const nodeTemplate = await db.node.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
let counter = 0;

async function node(name: string, agent: Stub, sealedWith?: string) {
  const base = { ...nodeTemplate } as Record<string, unknown>;
  for (const key of ["id", "createdAt", "name", "daemonUrl", "daemonToken", "state", "lastReachedAt", "reachDetail"]) delete base[key];
  for (const [key, value] of Object.entries(base)) if (value === null) delete base[key];
  return db.node.create({
    data: {
      ...(base as object),
      name,
      state: "HEALTHY",
      approvedAt: new Date(),
      lastReachedAt: new Date(),
      daemonUrl: agent.url,
      daemonToken: sealedWith ? sealWith(sealedWith, TOKEN) : encryptSecret(TOKEN),
    } as never,
  });
}

async function server(nodeId: string, label: string) {
  const n = ++counter;
  const base = { ...template } as Record<string, unknown>;
  for (const key of ["id", "createdAt", "updatedAt", "slug", "name", "host", "port", "nodeId", "runtimeId", "state"]) delete base[key];
  for (const [key, value] of Object.entries(base)) if (value === null) delete base[key];
  return db.server.create({
    data: {
      ...(base as object),
      slug: `ps-${label}-${n}`,
      name: `ps ${label} ${n}`,
      host: `ps-${label}-${n}.example.test`,
      port: 20_000 + n,
      nodeId,
      runtimeId: `stub-${label}-${n}`,
      state: "RUNNING",
      operation: null,
      operationOwner: null,
      operationStartedAt: null,
      operationBeat: null,
      stateBefore: null,
    } as never,
  });
}

const samplesOf = (ids: string[]) => db.metricSample.count({ where: { serverId: { in: ids } } });

try {
  /* ── 1. A token the key cannot open ──────────────────────────────── */
  console.log("\n== one node's token cannot be opened with this SECRETS_KEY ==");
  const [sa, sb, sc] = [await stub({ latency: 2 }), await stub({ latency: 2 }), await stub({ latency: 2 })];
  const na = await node("ps-a", sa);
  const nb = await node("ps-b", sb, OTHER_KEY);
  const nc = await node("ps-c", sc);
  const serversA = [await server(na.id, "a"), await server(na.id, "a")];
  const serversB = [await server(nb.id, "b"), await server(nb.id, "b")];
  const serversC = [await server(nc.id, "c"), await server(nc.id, "c")];

  const sealed = await checkSealedSecrets();
  check("the boot check counts it, by where it is kept", sealed.unreadable.length === 1 && sealed.unreadable[0]!.what === "node tokens" && sealed.unreadable[0]!.count === 1, JSON.stringify(sealed));
  check("and says it in one line", describeSealed(sealed) === "1 stored secret does not open with SECRETS_KEY (node tokens: 1)", String(describeSealed(sealed)));

  const first = await pollOnce();
  check("the pass reaches the end, and looks at all three nodes", first.nodesChecked === 3, JSON.stringify(first));
  check("the others are read as always: four servers, four samples", first.serversChecked === 4 && first.samplesWritten === 4, `${first.serversChecked}/${first.samplesWritten}`);
  check("the report names the node that cannot be opened", first.nodesUnreadable.length === 1 && first.nodesUnreadable[0] === "ps-b", JSON.stringify(first.nodesUnreadable));
  check("it counts as not reached, and the other two did not", first.nodesUnreachable === 1);
  const broken = await db.node.findUniqueOrThrow({ where: { name: "ps-b" } });
  check("its page can say why, in the cause's words and not OpenSSL's", broken.reachDetail === `ps-b: its token cannot be opened: ${SECRETS_KEY_SENTENCE}` && !/Unsupported state/.test(broken.reachDetail ?? ""), String(broken.reachDetail));
  check("none of its servers was touched or sampled", (await samplesOf(serversB.map((s) => s.id))) === 0 && (await db.server.findUniqueOrThrow({ where: { id: serversB[0]!.id } })).state === "RUNNING");
  check("the line is once per change, not one in each pass's problems", !first.errors.some((e) => e.startsWith("ps-b")), JSON.stringify(first.errors));
  check("the nodes either side of it were reached", (await samplesOf([...serversA, ...serversC].map((s) => s.id))) === 4);

  await db.node.update({ where: { id: nb.id }, data: { daemonToken: encryptSecret(TOKEN) } });
  const again = await pollOnce();
  const mended = await db.node.findUniqueOrThrow({ where: { name: "ps-b" } });
  check("with the right key it is read, and what it said is cleared", again.nodesUnreadable.length === 0 && mended.reachDetail === null && again.serversChecked === 6, JSON.stringify([again.nodesUnreadable, mended.reachDetail, again.serversChecked]));
  check("and the boot check finds nothing to say", describeSealed(await checkSealedSecrets()) === null);

  /* ── 2. A node that does not answer ──────────────────────────────── */
  console.log("\n== a node that does not answer holds nobody else ==");
  const silent = await stub({ silent: true });
  const fast = await stub({ latency: 5 });
  const nsilent = await node("ps-silent", silent);
  const nfast = await node("ps-fast", fast);
  const silentServers = [await server(nsilent.id, "silent"), await server(nsilent.id, "silent")];
  const fastServers = [await server(nfast.id, "fast"), await server(nfast.id, "fast"), await server(nfast.id, "fast")];
  const before = await samplesOf(fastServers.map((s) => s.id));
  const began = Date.now();
  const quiet = await pollOnce({ callTimeoutMs: 700 });
  const took = Date.now() - began;
  check("the pass is about one call's limit long, not one for each node in turn", took < 2_500, `${took} ms`);
  check("the node that answered was read in full while the other was waited for", (await samplesOf(fastServers.map((s) => s.id))) === before + 3);
  check("the silent one is not reached, and says it timed out", quiet.nodesUnreachable >= 1 && quiet.errors.some((e) => /timed out/.test(e)), JSON.stringify(quiet.errors));
  check("and nothing of its servers was written", (await samplesOf(silentServers.map((s) => s.id))) === 0);
  check("the pass says which node was slowest", quiet.slowestNode !== null && quiet.slowestNode.name === "ps-silent", JSON.stringify(quiet.slowestNode));
  await silent.close();
  await db.node.update({ where: { id: nsilent.id }, data: { approvedAt: null } });

  /* ── 3. A node past its deadline ─────────────────────────────────── */
  console.log("\n== a node that is slow is left to finish, and is not asked again until it has ==");
  const slow = await stub({ delay: { health: 1_800 }, latency: 2 });
  const nslow = await node("ps-slow", slow);
  await server(nslow.id, "slow");
  const t0 = Date.now();
  const late = await pollOnce({ nodeDeadlineMs: 400 });
  const lateMs = Date.now() - t0;
  check("the pass goes on without it after its deadline", lateMs < 1_300 && late.errors.some((e) => /^ps-slow: still being read after/.test(e)), `${lateMs} ms ${JSON.stringify(late.errors)}`);
  const t1 = Date.now();
  const skipped = await pollOnce({ nodeDeadlineMs: 400 });
  check("the next pass leaves it alone, with its name", skipped.nodesSkipped.includes("ps-slow") && Date.now() - t1 < 1_300, JSON.stringify(skipped.nodesSkipped));
  check("and asked its health only once", (slow.calls.health ?? 0) === 1, String(slow.calls.health));
  await sleep(1_800);
  const after = await pollOnce({ nodeDeadlineMs: 4_000 });
  check("once it has answered it is read again", !after.nodesSkipped.includes("ps-slow") && after.nodesChecked >= 1 && (slow.calls.health ?? 0) === 2, JSON.stringify(after.nodesSkipped));
  await db.node.update({ where: { id: nslow.id }, data: { approvedAt: null } });

  /* ── 4. A pass over the state it read ─────────────────────────────── */
  console.log("\n== a server an operation took during the pass is not written over ==");
  const target = serversA[0]!;
  const taking = await stub({
    latency: 2,
    hook: async (kind, id) => {
      if (kind === "stats" && id === target.runtimeId) {
        await db.server.update({ where: { id: target.id }, data: { state: "BACKING_UP", operation: "backup", operationOwner: "panel:test", operationStartedAt: new Date(), operationBeat: new Date(), stateBefore: "RUNNING" } });
      }
    },
  });
  await db.node.update({ where: { id: na.id }, data: { daemonUrl: taking.url } });
  const raced = await pollOnce();
  const kept = await db.server.findUniqueOrThrow({ where: { id: target.id } });
  check("it is still backing up, and still claimed", kept.state === "BACKING_UP" && kept.operation === "backup" && kept.operationOwner === "panel:test", `${kept.state}/${kept.operation}`);
  check("and the pass counts it as held", raced.held >= 1, String(raced.held));
  check("the others on that node were written as always", raced.samplesWritten >= 3);
  await db.server.update({ where: { id: target.id }, data: { state: "RUNNING", operation: null, operationOwner: null, operationStartedAt: null, operationBeat: null, stateBefore: null } });

  console.log("\n== a server whose backup holds it is still read ==");
  const backing = serversC[0]!;
  await db.server.update({ where: { id: backing.id }, data: { state: "BACKING_UP", operation: "backup", operationOwner: "panel:test", operationStartedAt: new Date(), operationBeat: new Date(), stateBefore: "RUNNING", playersOn: 3 } });
  const samplesBefore = await samplesOf([backing.id]);
  await pollOnce();
  await pollOnce();
  const held = await db.server.findUniqueOrThrow({ where: { id: backing.id } });
  const written = await db.metricSample.findMany({ where: { serverId: backing.id }, orderBy: { at: "desc" }, take: 2 });
  check("a sample is written in every pass while the backup runs", (await samplesOf([backing.id])) === samplesBefore + 2, `${await samplesOf([backing.id])} vs ${samplesBefore}`);
  check("it says what the game is using, and the players the last full look counted", written.length === 2 && written[0]!.ramMb === 900 && written[0]!.players === 3, `${written[0]?.ramMb} MB, ${written[0]?.players} players`);
  check("the state, the claim and the players are the backup's, untouched", held.state === "BACKING_UP" && held.operation === "backup" && held.operationOwner === "panel:test" && held.playersOn === 3 && held.stateBefore === "RUNNING");
  check("the counters it takes the network's next difference against moved with it", held.netRx !== null && held.netTx !== null && held.cpuPct === 12 && held.ramPct === 44, `${held.netRx} ${held.cpuPct} ${held.ramPct}`);
  await db.server.update({ where: { id: backing.id }, data: { state: "RUNNING", operation: null, operationOwner: null, operationStartedAt: null, operationBeat: null, stateBefore: null } });

  /* ── 5. A hundred servers on ten nodes ────────────────────────────── */
  const NODES = Number(process.env.POLLSCALE_NODES ?? 10);
  const PER = Number(process.env.POLLSCALE_SERVERS ?? 10);
  console.log(`\n== ${NODES * PER} servers on ${NODES} nodes, every call ${LATENCY} ms and stats ${STATS} ms ==`);
  await db.node.updateMany({ where: { name: { in: ["ps-a", "ps-b", "ps-c", "ps-fast"] } }, data: { approvedAt: null } });
  const big: Array<{ stub: Stub; serverIds: string[] }> = [];
  for (let i = 0; i < NODES; i++) {
    const s = await stub({ latency: LATENCY, statsMs: STATS });
    const n = await node(`ps-big-${i}`, s);
    const ids: string[] = [];
    for (let j = 0; j < PER; j++) ids.push((await server(n.id, `big${i}`)).id);
    big.push({ stub: s, serverIds: ids });
  }
  const times: number[] = [];
  let last = await pollOnce();
  resetLive();
  for (let round = 0; round < 3; round++) {
    const t = Date.now();
    last = await pollOnce();
    times.push(Date.now() - t);
  }
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  console.log(`  pass times over ${NODES * PER} servers: ${times.map((t) => `${seconds(t)} s`).join(", ")}; slowest node ${last.slowestNode?.name} ${last.slowestNode?.ms} ms`);
  const calls = Object.entries(big[0]!.stub.calls).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`  calls one node answered in the four passes: ${calls}`);
  check("every server was read and sampled in every pass", last.serversChecked === NODES * PER && last.samplesWritten === NODES * PER && last.errors.length === 0, JSON.stringify([last.serversChecked, last.samplesWritten, last.errors.slice(0, 2)]));
  const limit = Number(process.env.POLLSCALE_LIMIT_MS ?? 15_000);
  check(`the pass is shorter than the 15 s it promises (${seconds(Math.max(...times))} s)`, Math.max(...times) < limit, `${Math.max(...times)} ms`);
  check("no node had more than four of its servers asked at once", big.every((b) => (b.stub.peak.status ?? 0) <= 4), JSON.stringify(big.map((b) => b.stub.peak.status)));
  check("and over all nodes no more than eight servers at once: what the database's ten connections can serve", (livePeak.status ?? 0) <= 8 && (livePeak.status ?? 0) >= 4, String(livePeak.status));
  await db.node.updateMany({ where: { name: { startsWith: "ps-big-" } }, data: { approvedAt: null } });

  /* ── 6. Scheduled tasks ───────────────────────────────────────────── */
  console.log("\n== scheduled tasks: claimed before they run, a few at a time, one to a node ==");
  const tn = await Promise.all([stub({ delay: { command: 350 }, latency: 2 }), stub({ delay: { command: 350 }, latency: 2 }), stub({ delay: { command: 350 }, latency: 2 })]);
  const nodes = [await node("ps-t0", tn[0]!), await node("ps-t1", tn[1]!), await node("ps-t2", tn[2]!)];
  const onT0 = [await server(nodes[0]!.id, "t0"), await server(nodes[0]!.id, "t0")];
  const onT1 = [await server(nodes[1]!.id, "t1")];
  const onT2 = [await server(nodes[2]!.id, "t2")];
  const all = [...onT0, ...onT1, ...onT2];
  const mk = (serverId: string, minutesAgo: number, name: string) =>
    db.scheduledTask.create({ data: { serverId, name, kind: "COMMAND", cron: "0 4 * * *", payload: "list", enabled: true, nextRunAt: new Date(Date.now() - minutesAgo * 60_000) } });
  const tasks = [];
  for (const [i, s] of all.entries()) tasks.push(await mk(s.id, 1, `ps-task-${i}`));

  resetLive();
  const began2 = Date.now();
  const one = await runDueTasks(new Date(), { concurrency: 2 });
  const tookTasks = Date.now() - began2;
  const commandCalls = () => tn.reduce((n, s) => n + (s.calls.command ?? 0), 0);
  check("all four ran", one.ran === 4 && one.failed === 0, JSON.stringify(one));
  check("never two on one node", (tn[0]!.peak.command ?? 0) === 1 && (tn[1]!.peak.command ?? 0) === 1 && (tn[2]!.peak.command ?? 0) === 1, JSON.stringify(tn.map((s) => s.peak.command)));
  check("and two at once over all of them, which is faster than one after another", livePeak.command === 2 && tookTasks < 4 * 350 - 150, `peak ${livePeak.command}, ${tookTasks} ms`);
  const afterRun = await db.scheduledTask.findMany({ where: { id: { in: tasks.map((t) => t.id) } } });
  check("each moved on to its next time, and says it succeeded", afterRun.every((t) => t.lastResult === "SUCCEEDED" && t.nextRunAt !== null && t.nextRunAt.getTime() > Date.now()), JSON.stringify(afterRun.map((t) => [t.lastResult, t.nextRunAt])));

  // Two runners that look at the same minute: a task goes to one of them.
  const sentBefore = commandCalls();
  await db.scheduledTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
  const [x, y] = await Promise.all([runDueTasks(new Date(), { concurrency: 2 }), runDueTasks(new Date(), { concurrency: 2 })]);
  check("two runners at once run each task once between them", x.ran + y.ran === 4 && commandCalls() - sentBefore === 4, `${x.ran}+${y.ran}, ${commandCalls() - sentBefore} sent`);

  // One that falls due while the others are running is picked up in its turn.
  await db.scheduledTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
  const late1 = mk(onT2[0]!.id, 0, "ps-task-late-comer");
  const running = runDueTasks(new Date(), { concurrency: 2 });
  await sleep(120);
  const comer = await late1;
  const done = await running;
  const comerRow = await db.scheduledTask.findUniqueOrThrow({ where: { id: comer.id } });
  check("a task that fell due during the run was run by it", done.ran === 5 && comerRow.lastResult === "SUCCEEDED", `${done.ran} ${comerRow.lastResult}`);

  // The clock at the moment of its turn decides whether it is too late: fifteen minutes is the rule.
  await db.scheduledTask.updateMany({ where: { id: { in: [...tasks.map((t) => t.id), comer.id] } }, data: { enabled: false, nextRunAt: null } });
  const tooLate = await mk(onT1[0]!.id, 20, "ps-task-too-late");
  const justInTime = await mk(onT2[0]!.id, 5, "ps-task-in-time");
  const judged = await runDueTasks(new Date(), { concurrency: 2 });
  const lateRow = await db.scheduledTask.findUniqueOrThrow({ where: { id: tooLate.id } });
  const timeRow = await db.scheduledTask.findUniqueOrThrow({ where: { id: justInTime.id } });
  check("twenty minutes late is skipped, five is run", judged.skipped === 1 && judged.ran === 1 && lateRow.lastResult === "SKIPPED" && timeRow.lastResult === "SUCCEEDED", JSON.stringify(judged));
  check("and the skip is in the audit log", (await db.activityEvent.count({ where: { action: "task.skipped", target: "ps-task-too-late" } })) === 1);
  check("a stop between tasks starts no new one", (await (async () => {
    await db.scheduledTask.update({ where: { id: justInTime.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    const stopped = await runDueTasks(new Date(), { shouldStop: () => true });
    return stopped.due === 0;
  })()));
} finally {
  for (const s of open) await s.close().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
