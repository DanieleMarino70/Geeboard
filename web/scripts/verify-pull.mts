import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Pulling an image through the node, the way an install now does it.

   daemon/test/pulls.test.ts proves the arithmetic — what counts as
   moving, when a pull is stalled — against a real pull written down line
   by line. This proves the rest against the real engine: that the panel
   starts a pull on a node and watches it through to the end in the
   layers and bytes the node counted; that asking again for an image the
   node has costs nothing; that a name no registry has fails with the
   registry's own words; and that a create asked for before its image is
   there is refused at once rather than left to wait on a network.

   It downloads a real image, so it needs the network and costs about
   75 MB each run: node:22-bookworm-slim, removed first if it is there,
   and removed again afterwards unless it was there before. What happens
   when a pull stops moving is the unit test's: a registry that hangs
   mid-layer is not something Docker Desktop can be pointed at here. */

const { DaemonClient } = await import("../src/lib/daemon-client");
const { DockerRuntime } = await import("../src/domain/runtime/docker");

const IMAGE = "node:22-bookworm-slim";
const TOKEN = "pull-token-that-is-long-enough-here!!";
const PORT = 8900 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-pull";

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
const present = () =>
  docker
    .getImage(IMAGE)
    .inspect()
    .then(() => true)
    .catch(() => false);

let agent: ChildProcess | undefined;
const dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-pull-"));
const hadIt = await present();

try {
  await docker.ping();
  if (hadIt) await docker.getImage(IMAGE).remove({ force: true });
  check(`${IMAGE} is not on this machine to begin with`, !(await present()));

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "pull-node-01",
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
      GEEBOARD_CONTAINER_PREFIX: "geeboard-pull-",
    },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  check("the agent answers", up);

  const client = new DaemonClient("pull-node-01", `http://127.0.0.1:${PORT}`, TOKEN);
  const runtime = new DockerRuntime("pull-node-01", client);

  console.log("\n== a create before the image is there ==");
  const early = await client
    .createServer({
      serverId: "pullcheck",
      name: "pull-check",
      image: IMAGE,
      // Never bound: the refusal comes before anything is created.
      ports: [{ label: "Game", host: 29000 + Math.floor(Math.random() * 900), container: 25565, protocol: "tcp", loopback: true }],
      memoryMb: 256,
      cpuLimit: 50,
      env: {},
      command: [],
      start: false,
    })
    .then(
      () => null,
      (error: { status?: number; message?: string }) => error,
    );
  check("is refused at once, rather than waiting on a network", early?.status === 409, JSON.stringify(early));
  check("and says to pull it first", /not on this node yet/.test(early?.message ?? ""), early?.message);

  console.log("\n== the pull, watched ==");
  const readings: Array<{ phase: string; layers: number; downloaded: number; bytes: number; total: number; known: boolean }> = [];
  const started = Date.now();
  await runtime.fetchSource(IMAGE, (d) => {
    readings.push({
      phase: d.phase,
      layers: d.layers.total,
      downloaded: d.layers.downloaded,
      bytes: d.bytes.current,
      total: d.bytes.total,
      known: d.bytes.totalKnown,
    });
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`  (${readings.length} readings in ${seconds} s)`);
  for (const r of readings.filter((_, i, all) => i === 0 || i === all.length - 1 || i % 3 === 0)) console.log(`    ${JSON.stringify(r)}`);

  check("the image is on the machine afterwards", await present());
  check("it was watched, not waited on: more than one reading came back", readings.length > 1, String(readings.length));
  const downloading = readings.filter((r) => r.phase === "downloading");
  check("the node said how many layers there are", downloading.some((r) => r.layers > 0));
  check(
    "and the bytes it had, going up",
    downloading.length > 0 && downloading.every((r, i) => i === 0 || r.bytes >= downloading[i - 1]!.bytes),
    JSON.stringify(downloading.map((r) => r.bytes)),
  );
  const last = readings.at(-1);
  check("the last reading is done, with every layer in", last?.phase === "done" && last.downloaded === last.layers, JSON.stringify(last));
  check("and a total the node could vouch for", last?.known === true && (last?.total ?? 0) > 10 * 1024 ** 2, JSON.stringify(last));

  console.log("\n== asked again ==");
  const again: string[] = [];
  const t = Date.now();
  await runtime.fetchSource(IMAGE, (d) => {
    again.push(d.phase);
  });
  check("an image the node has is done at once, with no download to report", again.length === 0 && Date.now() - t < 5_000, JSON.stringify(again));

  console.log("\n== a name nobody has ==");
  const nowhere = await runtime.fetchSource("geeboard-verify/no-such-image:0").then(
    () => null,
    (error: { code?: string; message?: string; details?: { step?: string } }) => error,
  );
  check("fails, as a download", nowhere?.code === "SERVER_INSTALLATION_FAILED" && nowhere?.details?.step === "download", JSON.stringify(nowhere));
  check("with the registry's own reason in it", /denied|not found|does not exist|unauthorized/i.test(nowhere?.message ?? ""), nowhere?.message);

  console.log("\n== a pull the agent does not know ==");
  check("is a 404 the panel reads as nothing, not an error", (await client.pullStatus("alpine:0.0.0-never")) === null);
} finally {
  agent?.kill();
  // Put the machine back as it was: removed only if it was not here to begin with.
  if (!hadIt) await docker.getImage(IMAGE).remove({ force: true }).catch(() => {});
  await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
