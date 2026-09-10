import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import Docker from "dockerode";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* Creating a server, end to end and for real.

   provision.test.ts proves the daemon refuses a bad spec and the daemon
   integration suite proves it can make a container. This proves the
   thing above both: that the panel allocates a port nobody else has,
   refuses a node that cannot hold the server, creates a container that
   Docker agrees exists, and — the part worth the most — leaves nothing
   behind when any of it fails. */

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seed } = await import("../prisma/seed");
const { createServerOp, freePortFor } = await import("../src/lib/create-ops");
const { deleteServerOp } = await import("../src/lib/server-ops");
const { GAMES, gameById, portsFor } = await import("../src/lib/catalog");

const run = promisify(execFile);
const TOKEN = "create-token-that-is-long-enough-here!";
const PORT = 8700 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-create";
const ALPINE = "alpine:3.20";

/* The catalogue's Minecraft image, standing in. Pulling the real one is
   400 MB of somebody else's bandwidth for a test that only needs a
   container that starts and stays up, so a committed alpine wears its
   name for the duration — and any tag that was already there is put
   back at the end. */
const FIXTURE = gameById("minecraft-java")!.versions[0]!.image;

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
let dataRoot = "";
let previousFixtureId: string | null = null;
let blocker: Docker.Container | undefined;

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

async function pull(reference: string) {
  await new Promise<void>((resolve, reject) => {
    docker.pull(reference, (error: Error | null, stream: NodeJS.ReadableStream) => {
      if (error) return reject(error);
      docker.modem.followProgress(stream, (done: Error | null) => (done ? reject(done) : resolve()));
    });
  });
}

/** Every container this run is responsible for, whatever happens next. */
async function sweep() {
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => {});
  }
}

try {
  await docker.ping();
  await seed();

  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-create-"));
  await sweep();

  console.log("\n== fixture image ==");
  await pull(ALPINE);
  previousFixtureId = await docker
    .getImage(FIXTURE)
    .inspect()
    .then((i) => i.Id)
    .catch(() => null);

  const seedContainer = await docker.createContainer({
    Image: ALPINE,
    Labels: { [LABEL]: "seed" },
    Cmd: ["sh", "-c", 'echo "[00:00:00] Done! For help, type \\"help\\""; while true; do sleep 1; done'],
  });
  const [repo, tag] = FIXTURE.split(":") as [string, string];
  await seedContainer.commit({ repo, tag });
  await seedContainer.remove({ force: true });
  check("a fixture image stands in for the catalogue's", await docker.getImage(FIXTURE).inspect().then(() => true));

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "fra-node-02",
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");

  await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN) },
  });

  const mara = (await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } }));
  const tomas = (await db.user.findUniqueOrThrow({ where: { email: "tomas@ashfold.gg" } }));

  const base = {
    gameId: "minecraft-java",
    versionId: "paper-1-21-4",
    templateId: "survival",
    nodeName: "fra-node-02",
    memoryGb: 8,
    /* The seeded fra-node-02 already commits 13 of its 16 cores to the
       fixture's three servers, so everything this test places there is
       deliberately modest. Running out of room is its own section. */
    cpuLimit: 100,
    diskGb: 60,
  };

  console.log("\n== refusals, before anything is written ==");
  const rowsBefore = await db.server.count();

  const asModerator = await createServerOp(tomas, {
    ...base,
    name: "Not Allowed",
    host: "nope.ashfold.gg",
  });
  check("a moderator cannot create a server", !asModerator.ok, asModerator.title);

  const noName = await createServerOp(mara, { ...base, name: " ", host: "x.ashfold.gg" });
  check("an empty name is refused", !noName.ok, noName.title);

  const badHost = await createServerOp(mara, { ...base, name: "Bad Host", host: "not a host" });
  check("an invalid hostname is refused", !badHost.ok, badHost.title);

  /* fra-node-02 has 16 cores and its three seeded servers already
     commit 13 of them, so the largest CPU limit the catalogue allows
     for Minecraft is more than what is left. */
  const tooBig = await createServerOp(mara, {
    ...base,
    name: "Too Big",
    host: "big.ashfold.gg",
    cpuLimit: 800,
  });
  check("a server the node cannot hold is refused", !tooBig.ok, tooBig.title);
  check(
    "and the refusal says what is already committed",
    /already committed/.test(tooBig.body),
    tooBig.body,
  );

  const clash = await createServerOp(mara, {
    ...base,
    name: "Clashing",
    host: "aurora.ashfold.gg",
  });
  check("a subdomain already in use is refused", !clash.ok, clash.title);

  await db.node.update({ where: { name: "fra-node-02" }, data: { state: "DRAINING" } });
  const draining = await createServerOp(mara, {
    ...base,
    name: "Draining",
    host: "drain.ashfold.gg",
  });
  check("a draining node is refused", !draining.ok, draining.title);
  await db.node.update({ where: { name: "fra-node-02" }, data: { state: "HEALTHY" } });

  check("no row was written by any refusal", (await db.server.count()) === rowsBefore);
  check(
    "and no container was made",
    (await docker.listContainers({ all: true, filters: { label: [LABEL] } })).length === 0,
  );

  console.log("\n== creating a real server ==");
  const created = await createServerOp(mara, {
    ...base,
    name: "Nightwatch",
    host: "nightwatch.ashfold.gg",
  });
  check("the panel reports it created", created.ok, created.body);
  check("and hands back a slug", created.slug === "nightwatch", String(created.slug));

  const server = await db.server.findUniqueOrThrow({ where: { slug: "nightwatch" } });
  check("the row has a runtime handle", Boolean(server.runtimeId));
  check("it is running", server.state === "RUNNING", server.state);
  check("the limits are the ones asked for", server.memoryLimit === 8 && server.cpuLimit === 100);

  /* The seeded workspace already holds 25565 and 25566 on this node, so
     the first free block of three starts at 25568 — the same numbers
     the design's resources step shows. */
  check("it was allocated the first free port block", server.port === 25568, String(server.port));

  const inspect = await docker.getContainer(server.runtimeId!).inspect();
  check("Docker agrees the container is up", inspect.State.Running);
  check("it is named for a human", inspect.Name === "/geeboard-nightwatch", inspect.Name);
  check("it carries the managed label, pointing back at the server", inspect.Config.Labels[LABEL] === server.id);
  check("the memory ceiling reached Docker", inspect.HostConfig.Memory === 8 * 1024 ** 3);
  check("so did the CPU limit", inspect.HostConfig.NanoCpus === 1e9);
  check(
    "the server's own directory is mounted, and nothing else",
    inspect.HostConfig.Binds?.length === 1 &&
      inspect.HostConfig.Binds[0] === `${path.join(dataRoot, server.id)}:/data`,
    JSON.stringify(inspect.HostConfig.Binds),
  );

  const bound = portsFor(gameById("minecraft-java")!, server.port);
  const bindings = (inspect.HostConfig.PortBindings ?? {}) as Record<
    string,
    Array<{ HostPort?: string }>
  >;
  const published = new Set(
    Object.values(bindings)
      .flat()
      .map((binding) => binding?.HostPort),
  );
  check(
    "every port in the block is published",
    bound.every((p) => published.has(String(p.host))),
    [...published].join(","),
  );

  check("the data directory exists on the node", (await readdir(dataRoot)).includes(server.id));

  const { stdout } = await run("docker", [
    "ps",
    "--filter",
    "name=geeboard-nightwatch",
    "--format",
    "{{.Names}} {{.Status}}",
  ]);
  check("it appears in docker ps", stdout.includes("geeboard-nightwatch"), stdout.trim());
  check("and docker ps says it is up", /\bUp\b/.test(stdout), stdout.trim());

  console.log("\n== what creation leaves behind in the panel ==");
  const task = await db.scheduledTask.findFirst({ where: { serverId: server.id } });
  check("a daily backup was scheduled", task?.kind === "BACKUP" && task.cron === "0 3 * * *");
  check("and it has a next run", task?.nextRunAt instanceof Date);

  const event = await db.activityEvent.findFirst({
    where: { serverId: server.id, action: "server.created" },
  });
  check("the creation is in the audit log", Boolean(event));
  check(
    "with the node and address recorded",
    JSON.stringify(event?.changes ?? {}).includes("nightwatch.ashfold.gg:25568"),
    JSON.stringify(event?.changes),
  );

  console.log("\n== the next server gets the next block ==");
  const second = await createServerOp(mara, {
    ...base,
    name: "Second Watch",
    host: "second.ashfold.gg",
    memoryGb: 4,
    cpuLimit: 50,
    diskGb: 20,
  });
  check("a second server is created", second.ok, second.body);

  const secondRow = await db.server.findUniqueOrThrow({ where: { slug: "second-watch" } });
  check("on the block after the first", secondRow.port === 25571, String(secondRow.port));
  check("the two do not share a port", secondRow.port !== server.port);

  console.log("\n== rolling back a create that cannot start ==");
  /* A port bound outside the panel is the honest version of this: the
     allocator cannot see it, Docker accepts the container and then
     refuses to start it. Everything made along the way has to go. */
  const nextBase = (await freePortFor(gameById("minecraft-java")!, secondRow.nodeId))!;
  check("there is another free block to aim at", nextBase === 25574, String(nextBase));

  blocker = await docker.createContainer({
    Image: ALPINE,
    name: `verify-create-blocker-${Date.now()}`,
    Labels: { [LABEL]: "blocker" },
    Cmd: ["sh", "-c", "while true; do sleep 1; done"],
    ExposedPorts: { "9000/tcp": {} },
    HostConfig: { PortBindings: { "9000/tcp": [{ HostPort: String(nextBase) }] } },
  });
  await blocker.start();

  const rowsBeforeRollback = await db.server.count();
  const dirsBeforeRollback = (await readdir(dataRoot)).length;

  const doomed = await createServerOp(mara, {
    ...base,
    name: "Doomed",
    host: "doomed.ashfold.gg",
    memoryGb: 2,
    cpuLimit: 50,
    diskGb: 10,
  });
  check("the create fails", !doomed.ok, JSON.stringify(doomed));
  check("and says nothing was left behind", /nothing was left behind/i.test(doomed.body ?? ""), doomed.body);
  check("no row survives it", (await db.server.count()) === rowsBeforeRollback);
  check("the slug is free again", !(await db.server.findUnique({ where: { slug: "doomed" } })));
  check(
    "no container survives it",
    !(await docker.listContainers({ all: true, filters: { label: [LABEL] } })).some((c) =>
      c.Names.some((n) => n.includes("geeboard-doomed")),
    ),
  );
  check(
    "and no directory survives it",
    (await readdir(dataRoot)).length === dirsBeforeRollback,
    `${dirsBeforeRollback} before, ${(await readdir(dataRoot)).length} after`,
  );

  await blocker.remove({ force: true });
  blocker = undefined;

  console.log("\n== deleting takes the container and the world with it ==");
  await writeFile(path.join(dataRoot, server.id, "world.dat"), "a world nobody backed up");

  const wrongName = await deleteServerOp(mara, "nightwatch", "nightwtach");
  check("a mistyped confirmation refuses", !wrongName.ok, wrongName.title);
  check("and the container is untouched", (await docker.getContainer(server.runtimeId!).inspect()).State.Running);

  const deleted = await deleteServerOp(mara, "nightwatch", "Nightwatch");
  check("the delete succeeds", deleted.ok, deleted.body);
  check("the row is gone", !(await db.server.findUnique({ where: { slug: "nightwatch" } })));
  await assertGone(server.runtimeId!);
  check("the data directory is gone too", !(await readdir(dataRoot)).includes(server.id));
  check(
    "and its scheduled task went with it",
    (await db.scheduledTask.count({ where: { serverId: server.id } })) === 0,
  );

  console.log("\n== a node with no agent is simulated, and says so ==");
  const simulated = await createServerOp(mara, {
    ...base,
    name: "Ashburn Test",
    host: "ash-test.ashfold.gg",
    nodeName: "ash-node-01",
    memoryGb: 4,
    cpuLimit: 100,
    diskGb: 20,
  });
  check("it is still created", simulated.ok, simulated.body);
  check("labelled as simulated", /simulated/i.test(simulated.body ?? ""), simulated.body);

  const simulatedRow = await db.server.findUniqueOrThrow({ where: { slug: "ashburn-test" } });
  check("with no workload behind it", simulatedRow.runtimeId === null);
  check(
    "and the audit log says so",
    Boolean(
      await db.activityEvent.findFirst({
        where: { serverId: simulatedRow.id, action: "server.created.simulated" },
      }),
    ),
  );

  console.log("\n== a node fills up and then refuses ==");
  /* sgp-node-01 holds 64 GB and nothing yet, so two of the largest
     Minecraft servers the catalogue allows fill it exactly. It has no
     agent, so this is the arithmetic being tested and not Docker. */
  for (const n of [1, 2]) {
    const filler = await createServerOp(mara, {
      ...base,
      name: `Filler ${n}`,
      host: `filler-${n}.ashfold.gg`,
      nodeName: "sgp-node-01",
      memoryGb: 32,
      cpuLimit: 100,
      diskGb: 20,
    });
    check(`filling ${n} of 2 succeeds`, filler.ok, filler.body);
  }

  const full = await createServerOp(mara, {
    ...base,
    name: "One Too Many",
    host: "toomany.ashfold.gg",
    nodeName: "sgp-node-01",
    memoryGb: 1,
    cpuLimit: 50,
    diskGb: 5,
  });
  check("and then even 1 GB more is refused", !full.ok, full.title);
  check("on memory, by name", /out of memory/i.test(full.title), full.title);
  check("saying how much is committed", /64 of 64 GB/.test(full.body ?? ""), full.body);

  console.log("\n== every game in the catalogue allocates ==");
  for (const game of GAMES) {
    const port = await freePortFor(game, simulatedRow.nodeId);
    check(
      `${game.id} finds a free block in its range`,
      port !== null && port >= game.portBase && port < game.portBase + game.portSpan,
      String(port),
    );
  }
} finally {
  agent?.kill();
  if (blocker) await blocker.remove({ force: true }).catch(() => {});
  await sweep();

  // Put back whatever the fixture tag was pointing at, or remove it.
  await docker.getImage(FIXTURE).remove({ force: true }).catch(() => {});
  if (previousFixtureId) {
    const [repo, tag] = FIXTURE.split(":") as [string, string];
    await docker.getImage(previousFixtureId).tag({ repo, tag }).catch(() => {});
  }

  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  await seed();
  await db.$disconnect();
}

async function assertGone(containerId: string) {
  let gone = false;
  try {
    await docker.getContainer(containerId).inspect();
  } catch {
    gone = true;
  }
  check("the container is gone from Docker", gone);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
