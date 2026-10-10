import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Garry's Mod on a real server, from its own image, with real Workshop items.

   garrys-mod.test.ts proves what reaches server.cfg and that the start script fits the agent's rules for arguments; mods.test.ts
   which files the Mods tab writes. Neither proves that the game reads them: that the start script fetches an item from Steam,
   unpacks a legacy one, mounts both, and that a map from the Workshop is then a map the server loads. So this runs the whole of
   it, through the panel's own operations: a Trouble in Terrorist Town server made the way the wizard makes one, a legacy TTT map
   and an addon added on the Mods tab, the list applied, the map chosen in Settings, the node asked what it downloaded, the
   console asked what map it is on, an addon switched off, and the server stopped with `quit`, not killed.

     DATABASE_URL=…geeboard_verify… npm run verify:gmod

   Needs ceifa/garrysmod:debian-x64 (about 15 GB; pulled by the create if it is not here) and Steam. The items are small and public:
     159321088  ttt_minecraft_b5   3.5 MB  uploaded before the .gma format: a `_legacy.bin` the script unpacks
     104691717  PAC3               8.7 MB  a .gma */

process.env.GEEBOARD_VERSION ??= JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")).version;
const AGENT_VERSION: string = JSON.parse(await readFile(path.join(process.cwd(), "..", "daemon", "package.json"), "utf8")).version;

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seedEmpty } = await import("../prisma/seed");
const { createServerOp } = await import("../src/lib/create-ops");
const { deleteServerOp, restartServerOp, sendConsoleCommandOp, stopServerOp } = await import("../src/lib/server-ops");
const { updateServerConfigOp } = await import("../src/lib/config-ops");
const { addModOp, applyModsOp, modsView, refreshInstalledOp, setModEnabledOp } = await import("../src/lib/mod-ops");
const { requireGame } = await import("../src/domain/games/registry");

const MAP = { workshopId: "159321088", name: "ttt_minecraft_b5" };
const ADDON = { workshopId: "104691717", title: /PAC3/ };

const TOKEN = "gmod-token-that-is-long-enough-here!!";
const LABEL = "gg.geeboard.verify-gmod";

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

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 120, everyMs = 2000) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  console.log(`  …gave up waiting for ${label}`);
  return false;
}

async function sweep() {
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => {});
  }
}

/* This run of the container's output, as Docker kept it, from the moment Docker says it started (Docker's clock, not this machine's). */
async function currentRun(runtimeId: string): Promise<string> {
  const container = docker.getContainer(runtimeId);
  const startedAt = Date.parse((await container.inspect()).State.StartedAt);
  const raw = (await container.logs({ stdout: true, stderr: true, since: Math.floor(startedAt / 1000), follow: false })) as unknown as Buffer;
  return raw.toString("utf8").replace(/[\u0000-\u0008]/g, "");
}

/** Waits for the game's ready line, or for its own words that it has no map, and returns what it printed. */
async function started(runtimeId: string): Promise<string> {
  let text = "";
  await waitFor(
    async () => {
      text = await currentRun(runtimeId);
      return /Connection to Steam servers successful|map load failed/.test(text);
    },
    "the game to come up",
    150,
    4000,
  );
  return text;
}

const port = 8900 + Math.floor(Math.random() * 90);
const nodeName = "gmod-node";
const dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-gmod-"));
let agent: ChildProcess | undefined;
const began = Date.now();

try {
  await docker.ping();
  await seedEmpty();
  await sweep();

  const gmod = requireGame("garrys-mod");
  const version = gmod.versions[0]!;
  console.log(`\n==== ${gmod.name} · ${version.label} ====`);
  console.log("\n== a node, an agent ==");
  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(port),
      GEEBOARD_NODE_NAME: nodeName,
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
      GEEBOARD_CONTAINER_PREFIX: "geeboard-gmod-",
      GEEBOARD_VERSION: AGENT_VERSION,
    },
    stdio: "ignore",
  });
  check("the agent answers", await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok, "agent", 30, 500));

  const info = (await docker.info()) as { OSType: string; Architecture: string; MemTotal: number };
  await db.node.create({
    data: {
      name: nodeName,
      city: "here",
      region: "local",
      state: "HEALTHY",
      pingMs: 1,
      cpuPct: 0,
      ramPct: 0,
      diskPct: 0,
      cpuCores: 8,
      ramTotal: Math.max(8, Math.round(info.MemTotal / 1024 ** 3)),
      diskTotal: 200,
      daemon: AGENT_VERSION,
      os: info.OSType.toLowerCase(),
      arch: info.Architecture === "x86_64" ? "x64" : info.Architecture,
      // What a plain Docker node declares: the game asks for nothing more.
      capabilities: ["docker"],
      registeredAt: new Date(),
      approvedAt: new Date(),
      daemonUrl: `http://127.0.0.1:${port}`,
      daemonToken: encryptSecret(TOKEN),
    },
  });
  const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });

  console.log("\n== a TTT server, made the way the wizard makes one ==");
  const created = await createServerOp(owner, {
    name: "Terror Town",
    host: "127.0.0.1",
    gameId: gmod.id,
    versionId: version.id,
    templateId: "ttt",
    nodeName,
    memoryGb: 3,
    cpuLimit: 200,
    diskGb: 20,
  });
  check("it is created", created.ok, created.body);
  if (!created.ok) throw new Error(created.body);
  const server = await db.server.findFirstOrThrow({ where: { name: "Terror Town" } });
  const slug = server.slug;
  const data = path.join(dataRoot, server.id);

  const first = await started(server.runtimeId!);
  check("the game comes up: it says it reached Steam", /Connection to Steam servers successful/.test(first), first.slice(-400));
  check("in Trouble in Terrorist Town", /Changing gamemode to Trouble in Terrorist Town \(terrortown\)/.test(first));
  check("on cs_office, a Counter-Strike: Source map the image mounts", !/map load failed/.test(first));
  check("and its output reaches the panel without a terminal's colours", !first.includes("\u001b["));
  const cfg = await readFile(path.join(data, "geeboard", "server.cfg"), "utf8").catch(() => "");
  check("the server's name is a quoted line of server.cfg, in the server's own folder", /^hostname "Geeboard"$/m.test(cfg), cfg);

  console.log("\n== Workshop items, from the Mods tab ==");
  const view0 = await modsView(owner, slug);
  check("the Mods tab offers Garry's Mod a shelf", view0?.support?.appId === 4000 && view0.whole === true);
  const map = await addModOp(owner, slug, `https://steamcommunity.com/sharedfiles/filedetails/?id=${MAP.workshopId}`);
  check(`a TTT map is added by its link: ${map.title}`, map.ok, map.body);
  const addon = await addModOp(owner, slug, ADDON.workshopId);
  check("and an addon by its id, with its real title", addon.ok && ADDON.title.test(addon.title), addon.title);

  const preview = await modsView(owner, slug);
  const files = new Map(preview?.loadOrder?.writes.map((w) => [w.file, w.text]) ?? []);
  check(
    "the preview shows the list the server reads, in order",
    files.get("geeboard/workshop.txt")?.trim().split("\n").slice(1).join(",") === `${MAP.workshopId},${ADDON.workshopId}`,
    files.get("geeboard/workshop.txt"),
  );
  check("and the AddWorkshop lines players' games are told", /resource\.AddWorkshop\("104691717"\)/.test(files.get("geeboard/workshop.lua") ?? ""));
  check("both wait for a download", preview?.awaitingDownload === 2, String(preview?.awaitingDownload));

  // No backup: a backup asks for room this PC may not have, and backups have their own suite.
  const applied = await applyModsOp(owner, slug, { backup: false });
  check("the list is applied", applied.ok, applied.body);
  check("the file on the node is the preview", (await readFile(path.join(data, "geeboard", "workshop.txt"), "utf8")) === files.get("geeboard/workshop.txt"));

  console.log("\n== the Workshop map, chosen in Settings ==");
  const changed = await updateServerConfigOp(owner, slug, { map: MAP.name }, { recreate: true });
  check("the map is saved, and the server rebuilt around it", changed.ok, changed.body);
  const rebuilt = await db.server.findUniqueOrThrow({ where: { id: server.id } });
  const second = await started(rebuilt.runtimeId!);
  check(`the start script fetched and mounted the legacy map`, second.includes(`Geeboard: Workshop item ${MAP.workshopId} is mounted`), second.slice(-600));
  check("and the addon", second.includes(`Geeboard: Workshop item ${ADDON.workshopId} is mounted`));
  check("the game added both as addons", (second.match(/Adding Filesystem Addon 'addons\/geeboard-/g) ?? []).length === 2);
  check(`and loaded ${MAP.name}`, !/map load failed/.test(second) && /Connection to Steam servers successful/.test(second), second.match(/map load failed.*/)?.[0]);

  const asked = await sendConsoleCommandOp(owner, slug, "status");
  check("a command from the panel's console reaches the game", asked.ok, asked.body);
  check(
    "and the game answers it: it is on the Workshop map",
    await waitFor(async () => new RegExp(`map\\s+: ${MAP.name}`).test(await currentRun(rebuilt.runtimeId!)), "status", 15, 1000),
  );

  const found = await refreshInstalledOp(owner, slug);
  check("Ask the node: everything is downloaded", found.ok && /Everything is downloaded/.test(found.title), `${found.title} ${found.body}`);
  const view1 = await modsView(owner, slug);
  check("and the tab says so, item by item", view1?.mods.every((m) => m.downloaded) === true && view1.awaitingDownload === 0);
  check("nothing is pending", view1?.pending === false);

  console.log("\n== an addon switched off ==");
  await setModEnabledOp(owner, slug, ADDON.workshopId, false);
  const off = await modsView(owner, slug);
  check("switched off is a change to apply", off?.pending === true);
  await applyModsOp(owner, slug, { backup: false });
  const list = await readFile(path.join(data, "geeboard", "workshop.txt"), "utf8");
  check("it leaves the list the server reads", !list.includes(ADDON.workshopId) && list.includes(MAP.workshopId), list);
  const lua = await readFile(path.join(data, "geeboard", "workshop.lua"), "utf8");
  check("and the one players are told", !lua.includes(ADDON.workshopId) && lua.includes(MAP.workshopId), lua);
  const restarted = await restartServerOp(owner, slug);
  check("the server restarts", restarted.ok, restarted.body);
  const third = await started((await db.server.findUniqueOrThrow({ where: { id: server.id } })).runtimeId!);
  check("and mounts only the map", third.includes(`Workshop item ${MAP.workshopId} is mounted`) && !third.includes(`Workshop item ${ADDON.workshopId} is mounted`));

  console.log("\n== stopped with quit, not killed ==");
  const t = Date.now();
  const stopped = await stopServerOp(owner, slug);
  const runtimeId = (await db.server.findUniqueOrThrow({ where: { id: server.id } })).runtimeId!;
  const exit = (await docker.getContainer(runtimeId).inspect()).State;
  check("the server stops", stopped.ok, stopped.body);
  check(`with exit code 0 (${exit.ExitCode}), in ${Math.round((Date.now() - t) / 1000)} s`, !exit.Running && exit.ExitCode === 0);

  console.log("\n== cleaning up ==");
  const deleted = await deleteServerOp(owner, slug, server.name);
  check("the server is deleted", deleted.ok, deleted.body);
} catch (error) {
  fail++;
  console.log(`  FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  agent?.kill();
  await sweep();
  await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed, in ${Math.round((Date.now() - began) / 1000)} s`);
  process.exit(fail === 0 ? 0 : 1);
}
