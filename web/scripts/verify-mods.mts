import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Mods on a real server, with real mods.

   mods.test.ts proves which keys get written and the daemon's own
   mods.test.ts proves what a download is read back as. Neither proves
   the thing that actually matters, which is that Project Zomboid — the
   game, on a node, in a container — reads those keys, fetches somebody
   else's mod from Steam, and comes back up with it loaded and its world
   where it left it.

   So this runs the whole of it: a server created through the panel's own
   operation, two Workshop items added through the panel's own
   operations, the list applied, the game restarted, the node asked what
   it downloaded, the load list written from that answer, and then a mod
   taken off again with the world still there afterwards.

   It is slow — a Zomboid world is generated once and the downloads are
   Steam's — and it needs about 6 GB free for the container. That is the
   price of proving it rather than asserting it.

   The mods are two small, real, public ones:
     2033451936  Let Me Think        ~1 MB
     2392709985  Tsar's Common Library ~9 MB */

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seedEmpty } = await import("../prisma/seed");
const { createServerOp } = await import("../src/lib/create-ops");
const { deleteServerOp, restartServerOp } = await import("../src/lib/server-ops");
const { addModOp, applyModsOp, modsView, refreshInstalledOp, removeModOp, setModEnabledOp } = await import(
  "../src/lib/mod-ops"
);
const { requireGame } = await import("../src/domain/games/registry");

const TOKEN = "mods-token-that-is-long-enough-here!!";
const PORT = 8900 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-mods";
const NODE = "mods-node-01";
const SLUG = "modded";
const LET_ME_THINK = "2033451936";
const TSAR = "2392709985";

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

/** The game's own settings file, read off the node's disk. */
async function settings(serverId: string): Promise<string> {
  return readFile(path.join(dataRoot, serverId, "Server", "geeboard.ini"), "utf8").catch(() => "");
}

function keyIn(text: string, key: string): string {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "<missing>";
}

try {
  await docker.ping();
  await seedEmpty();
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-mods-"));
  await sweep();

  const zomboid = requireGame("project-zomboid");
  const version = zomboid.versions.find((v) => v.line === "build41" || v.label.includes("41"))!;
  console.log(`\n== a node, an agent, and ${zomboid.name} ${version.label} ==`);

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: NODE,
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
      GEEBOARD_CONTAINER_PREFIX: "geeboard-mods-",
    },
    stdio: "ignore",
  });
  check("the agent answers", await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent", 30, 500));

  const info = (await docker.info()) as { OSType: string; Architecture: string; MemTotal: number };
  await db.node.create({
    data: {
      name: NODE,
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
      daemon: process.env.GEEBOARD_VERSION ?? "0.1.0",
      os: info.OSType.toLowerCase(),
      arch: info.Architecture === "x86_64" ? "x64" : info.Architecture,
      capabilities: ["docker", "steamcmd", "java"],
      registeredAt: new Date(),
      approvedAt: new Date(),
      daemonUrl: `http://127.0.0.1:${PORT}`,
      daemonToken: encryptSecret(TOKEN),
    },
  });

  const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });

  console.log("\n== the server, made the way the wizard makes one ==");
  const created = await createServerOp(owner, {
    name: "Modded",
    host: "127.0.0.1",
    gameId: zomboid.id,
    versionId: version.id,
    templateId: zomboid.templates[0]!.id,
    nodeName: NODE,
    memoryGb: 6,
    cpuLimit: 200,
    diskGb: 20,
  });
  check("it is created", created.ok, created.body);
  if (!created.ok) throw new Error(created.body);

  const server = await db.server.findUniqueOrThrow({ where: { slug: created.slug ?? SLUG } });
  const slug = server.slug;

  console.log("\n== before any mod ==");
  const empty = await modsView(owner, slug);
  check("the panel offers mods for this game", empty?.support?.provider === "steam-workshop");
  check("and says there are none", empty?.mods.length === 0);
  check("with nothing to apply", empty?.pending === false);

  console.log("\n== two mods, chosen from the Workshop ==");
  const first = await addModOp(owner, slug, `https://steamcommunity.com/sharedfiles/filedetails/?id=${LET_ME_THINK}`);
  check("a pasted Workshop link is added, by its real title", first.ok && /Let Me Think/i.test(first.title), first.title);

  const second = await addModOp(owner, slug, TSAR);
  check("and an id on its own", second.ok, second.title);

  const again = await addModOp(owner, slug, LET_ME_THINK);
  check("the same item twice is refused", !again.ok, again.title);

  const nonsense = await addModOp(owner, slug, "not a workshop item");
  check("and so is something that is not an item", !nonsense.ok, nonsense.title);

  const chosen = await modsView(owner, slug);
  check("both are on the list", chosen?.mods.length === 2);
  check("the list is not what the server is running", chosen?.pending === true);
  check("and neither has been downloaded yet", chosen?.awaitingDownload === 2);

  console.log("\n== applied to the server ==");
  const applied = await applyModsOp(owner, slug, { backup: false });
  check("the list is written", applied.ok, applied.body);

  const written = await settings(server.id);
  check(
    "the game's own settings carry both Workshop ids",
    keyIn(written, "WorkshopItems") === `${LET_ME_THINK};${TSAR}`,
    keyIn(written, "WorkshopItems"),
  );
  check(
    "and nothing is loaded yet, because nothing is downloaded yet",
    keyIn(written, "Mods") === "",
    keyIn(written, "Mods"),
  );
  check("the panel no longer says pending", (await modsView(owner, slug))?.pending === false);

  console.log("\n== the game fetches them itself, on the node ==");
  /* The game reads that file as it starts, so a list written to a
     running server means nothing until it goes round again — which is
     the restart the panel tells an operator to do. */
  const restarted = await restartServerOp(owner, slug);
  check("the server restarts, and reads the list on its way up", restarted.ok, restarted.body);

  const downloaded = await waitFor(
    async () => {
      const found = await refreshInstalledOp(owner, slug);
      const view = await modsView(owner, slug);
      return found.ok && view?.awaitingDownload === 0;
    },
    "Steam to deliver both mods",
    150,
    4000,
  );
  check("both downloads arrive and the node says what is in them", downloaded);

  const installed = await modsView(owner, slug);
  const letMeThink = installed?.mods.find((mod) => mod.workshopId === LET_ME_THINK);
  check(
    "read off the node, not guessed: Let Me Think carries the id LetMeThink",
    letMeThink?.modIds.includes("LetMeThink") === true,
    JSON.stringify(letMeThink?.modIds),
  );
  check("the list is pending again, now that there is something to load", installed?.pending === true);

  console.log("\n== loaded ==");
  const loading = await applyModsOp(owner, slug, { backup: false });
  check("the load list is written", loading.ok, loading.body);
  const loaded = await settings(server.id);
  check("the game is told to load them", keyIn(loaded, "Mods").includes("LetMeThink"), keyIn(loaded, "Mods"));

  const up = await restartServerOp(owner, slug);
  check("the world starts again with its mods", up.ok, up.body);
  const running = await waitFor(
    async () => (await db.server.findUniqueOrThrow({ where: { slug } })).state === "RUNNING",
    "the server to be running",
    40,
    3000,
  );
  check("and the panel sees it running", running);

  console.log("\n== switched off, and taken away ==");
  const off = await setModEnabledOp(owner, slug, TSAR, false);
  check("a mod can be switched off without losing its download", off.ok, off.title);
  await applyModsOp(owner, slug, { backup: false });
  const afterOff = await settings(server.id);
  check(
    "it stays in the downloads and leaves the load list",
    keyIn(afterOff, "WorkshopItems").includes(TSAR) && !keyIn(afterOff, "Mods").includes("Tsar"),
    `${keyIn(afterOff, "WorkshopItems")} | ${keyIn(afterOff, "Mods")}`,
  );

  const worldBefore = await readFile(path.join(dataRoot, server.id, "Server", "geeboard.ini"), "utf8");
  const removed = await removeModOp(owner, slug, LET_ME_THINK);
  check("a mod is removed from the list", removed.ok, removed.title);
  await applyModsOp(owner, slug, { backup: false });
  const afterRemove = await settings(server.id);
  check(
    "and from what the game downloads and loads",
    !keyIn(afterRemove, "WorkshopItems").includes(LET_ME_THINK) && !keyIn(afterRemove, "Mods").includes("LetMeThink"),
    `${keyIn(afterRemove, "WorkshopItems")} | ${keyIn(afterRemove, "Mods")}`,
  );
  check("the world's own settings are otherwise untouched", worldBefore.length > 0 && afterRemove.length > 0);

  const back = await restartServerOp(owner, slug);
  check("and the world starts without it", back.ok, back.body);

  console.log("\n== cleaning up ==");
  const deleted = await deleteServerOp(owner, slug, "Modded");
  check("the server is deleted", deleted.ok, deleted.body);
} finally {
  agent?.kill();
  await sweep();
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
