import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Mods on a real server, with real mods, on both builds of the game.

   mods.test.ts and mod-builds.test.ts prove which keys get written and
   which mods a build loads, and the daemon's own mods.test.ts proves
   what a download is read back as. None of them proves the thing that
   actually matters, which is that Project Zomboid — the game, on a node,
   in a container — reads those keys, fetches somebody else's mod from
   Steam, and comes back up with it loaded and its world where it left
   it. Nor that the panel keeps out of the load list the mod that build
   would not see.

   So this runs the whole of it, once per build: a server created through
   the panel's own operation, three Workshop items added through the
   panel's own operations — two for this build, one tagged for the other
   — the list applied, the game restarted, the node asked what it
   downloaded, the load list written from that answer, the game's own
   console read for what it loaded, and then a mod taken off again with
   the world still there afterwards.

   It is slow — a Zomboid world is generated once per build and the
   downloads are Steam's — and each run needs about 4 GB for the
   container, so the builds go one after the other, never together.
   That is the price of proving it rather than asserting it.

     npm run verify:mods                # both, 41 then 42
     npm run verify:mods -- --build 42  # one

   The mods are small, real and public:
     Build 41  2033451936  Let Me Think                  ~1 MB
               2392709985  Tsar's Common Library         ~10 MB
     Build 42  3459887404  Building Craft                ~4 MB   42.0/ and common/
               3738485004  BuildingCraft Extension       ~3 MB   an empty 42/, mod.info in common/
   and each build is also given one of the other's, which it must not load:
     on 41     3802958447  B&B Building Craft Addon      42.0/ only
     on 42     3341098558  Building Menu TryHonesty addon  a mod.info at the top, versionMax=41.78
   and Build 42 one of its own that it must not load either, because it
   requires a tile pack nobody added:
     on 42     3488891189  BuildingCraft - Erika's tiles  require=\BuildingCraft,\Erikas_Tiles ~0.4 MB */

// The panel's own version, as a built panel has it inlined, so the release-line check runs as it would.
process.env.GEEBOARD_VERSION ??= JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")).version;
const AGENT_VERSION: string = JSON.parse(
  await readFile(path.join(process.cwd(), "..", "daemon", "package.json"), "utf8"),
).version;

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seedEmpty } = await import("../prisma/seed");
const { createServerOp } = await import("../src/lib/create-ops");
const { deleteServerOp, restartServerOp } = await import("../src/lib/server-ops");
const {
  addCollectionOp,
  addModOp,
  applyModsOp,
  modsView,
  refreshInstalledOp,
  removeCollectionOp,
  removeModOp,
  searchModsOp,
  setModEnabledOp,
} = await import("../src/lib/mod-ops");
const { requireGame } = await import("../src/domain/games/registry");

interface Plan {
  build: "41" | "42";
  /** The two this build loads: the first is switched off, the second removed, at the end. */
  loads: Array<{ workshopId: string; modId: string; title: RegExp }>;
  /** Tagged for the other build: added with a warning, downloaded, kept out of the load list. */
  other: { workshopId: string; modId: string; refusal: RegExp };
  /** For this build, and requiring a mod the server does not have: downloaded, kept out, the missing one named. */
  needs?: { workshopId: string; modId: string; missing: string };
  /** The second of `loads` requires the first, so switching the first off does not stop it loading. */
  secondRequiresFirst?: boolean;
}

const PLANS: Plan[] = [
  {
    build: "41",
    loads: [
      { workshopId: "2033451936", modId: "LetMeThink", title: /Let Me Think/i },
      { workshopId: "2392709985", modId: "tsarslib", title: /Tsar/i },
    ],
    other: { workshopId: "3802958447", modId: "BB_Tiles_BuildingCraft", refusal: /newer build/ },
  },
  {
    build: "42",
    loads: [
      { workshopId: "3459887404", modId: "BuildingCraft", title: /Building Craft/i },
      { workshopId: "3738485004", modId: "BuildingCraftPipetteCopy", title: /BuildingCraft Extension/i },
    ],
    other: { workshopId: "3341098558", modId: "BuildingMenuTryHonestysAddon", refusal: /older build/ },
    // Found by the proof in the running panel: the game skipped it, for a tile pack nobody had added.
    needs: { workshopId: "3488891189", modId: "BuildingCraftErikastiles", missing: "Erikas_Tiles" },
    secondRequiresFirst: true,
  },
];

/** Rawt Building Craft: five items tagged Build 42 and one Build 41, measured September 2026. */
const COLLECTION = "3806120559";

const TOKEN = "mods-token-that-is-long-enough-here!!";
const LABEL = "gg.geeboard.verify-mods";

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

function keyIn(text: string, key: string): string {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "<missing>";
}

/* The game's console for its current run, as Docker kept it: what it
   loaded is "loading <id>", and a mod it could not see is "required mod
   "<id>" not found" — which it logs and then starts anyway.

   "Current run" is from the moment Docker says the container started,
   in Docker's own clock. This machine's clock is not Docker's: Docker
   Desktop's VM can trail it after a boot, and a cut taken from here then
   loses a Build 41 server's first seconds — which is exactly when it
   says what it loaded. */
async function currentRun(runtimeId: string): Promise<string> {
  const container = docker.getContainer(runtimeId);
  const startedAt = Date.parse((await container.inspect()).State.StartedAt);
  const raw = (await container.logs({
    stdout: true,
    stderr: true,
    since: Math.floor(startedAt / 1000),
    follow: false,
  })) as unknown as Buffer;
  // Docker frames each chunk with an eight-byte header; the text is what matters here.
  return raw.toString("utf8").replace(/[\u0000-\u0008]/g, "");
}

async function started(runtimeId: string): Promise<string> {
  let text = "";
  await waitFor(
    async () => {
      text = await currentRun(runtimeId);
      return /SERVER STARTED/.test(text);
    },
    "the game to say SERVER STARTED",
    150,
    4000,
  );
  return text;
}

async function run(plan: Plan) {
  const port = 8900 + Math.floor(Math.random() * 90);
  const nodeName = `mods-node-${plan.build}`;
  const dataRoot = await mkdtemp(path.join(tmpdir(), `geeboard-verify-mods-${plan.build}-`));
  let agent: ChildProcess | undefined;

  try {
    await seedEmpty();
    await sweep();

    const zomboid = requireGame("project-zomboid");
    const version = zomboid.versions.find((v) => v.line === `b${plan.build}`)!;
    console.log(`\n==== ${zomboid.name} ${version.label} (${version.upstream}) ====`);
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
        GEEBOARD_CONTAINER_PREFIX: "geeboard-mods-",
        // Its own number, not the panel's set above: the variable overrides an agent's.
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
        capabilities: ["docker", "steamcmd", "java"],
        registeredAt: new Date(),
        approvedAt: new Date(),
        daemonUrl: `http://127.0.0.1:${port}`,
        daemonToken: encryptSecret(TOKEN),
      },
    });

    const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } });

    console.log("\n== the server, made the way the wizard makes one ==");
    /* 4 GB, under the game's own 6: a world with a handful of small mods
       starts in it, and 6 would not fit beside anything on this machine. */
    const created = await createServerOp(owner, {
      name: `Modded ${plan.build}`,
      host: "127.0.0.1",
      gameId: zomboid.id,
      versionId: version.id,
      templateId: zomboid.templates[0]!.id,
      nodeName,
      memoryGb: 4,
      cpuLimit: 200,
      diskGb: 20,
    });
    check("it is created", created.ok, created.body);
    if (!created.ok) throw new Error(created.body);

    const server = await db.server.findUniqueOrThrow({ where: { slug: created.slug! } });
    const slug = server.slug;
    const settings = () => readFile(path.join(dataRoot, server.id, "Server", "geeboard.ini"), "utf8").catch(() => "");

    console.log("\n== before any mod ==");
    const empty = await modsView(owner, slug);
    check("the panel offers mods for this game", empty?.support?.provider === "steam-workshop");
    check("and says there are none", empty?.mods.length === 0);
    check("with nothing to apply", empty?.pending === false);
    check(`and knows the server is ${version.label}`, empty?.build?.label === version.label, JSON.stringify(empty?.build));

    console.log("\n== what the Workshop's tags say, before anything is added ==");
    const preview = await searchModsOp(owner, slug, `https://steamcommunity.com/sharedfiles/filedetails/?id=${COLLECTION}`);
    check("a pasted collection is previewed", Boolean(preview.ok && preview.collection), preview.title);
    check(
      `and its items' build tags are counted against ${version.label}`,
      preview.collection?.builds === (plan.build === "42" ? "5 for Build 42, 1 for Build 41 only" : "1 for Build 41, 5 for Build 42 only"),
      String(preview.collection?.builds),
    );

    console.log("\n== a collection arrives as one, and leaves as one ==");
    /* One of its mods added on its own first: the collection adds the
       rest and counts that one as its own, and removing the collection
       takes all of them — and leaves a mod it never had. */
    const collected = preview.collection?.items ?? [];
    const lone = await addModOp(owner, slug, collected[0]!.id);
    // [B42+] Sandbox Options, a real Zomboid item in no collection here. Listed, never applied.
    const outsider = await addModOp(owner, slug, "3386906181");
    check("a mod from outside it is on the list too", outsider.ok, outsider.body);
    const brought = await addCollectionOp(owner, slug, COLLECTION);
    check(
      "the collection adds what the server does not have",
      lone.ok && brought.ok && brought.added === collected.length - 1,
      `${brought.title} ${brought.body}`,
    );
    check("and counts the one already here as its own", brought.ok && /now counted as this collection's/.test(brought.body), brought.body);
    const withIt = await modsView(owner, slug);
    const theirs = withIt?.mods.filter((mod) => mod.collection?.id === COLLECTION) ?? [];
    check(
      "every one of its mods says where it came from",
      theirs.length === collected.length && withIt?.collections.some((c) => c.id === COLLECTION && c.count === collected.length) === true,
      JSON.stringify(withIt?.collections),
    );
    const dropped = await removeCollectionOp(owner, slug, COLLECTION);
    const without = await modsView(owner, slug);
    check("removed, it takes all of them", dropped.ok && dropped.removed === collected.length, `${dropped.title} ${dropped.body}`);
    check(
      "and nothing it did not bring",
      without?.mods.length === 1 && without.mods[0]!.workshopId === "3386906181" && !without.mods[0]!.collection,
      JSON.stringify(without?.mods.map((mod) => mod.workshopId)),
    );
    for (const mod of without?.mods ?? []) await removeModOp(owner, slug, mod.workshopId);

    const [first, second] = plan.loads;
    const count = plan.needs ? 4 : 3;
    const many = count === 4 ? "four" : "three";
    const refusedCount = plan.needs ? 2 : 1;
    console.log(`\n== ${many} mods, chosen from the Workshop ==`);
    const a = await addModOp(owner, slug, `https://steamcommunity.com/sharedfiles/filedetails/?id=${first!.workshopId}`);
    check("a pasted Workshop link is added, by its real title", a.ok && first!.title.test(a.title), a.title);
    check("and, tagged for this build, without a warning", a.ok && a.tone === "success", a.ok ? a.tone : a.body);
    const b = await addModOp(owner, slug, second!.workshopId);
    check("and an id on its own", b.ok, b.title);

    const other = await addModOp(owner, slug, plan.other.workshopId);
    check(
      "one tagged only for the other build is added — with a warning, not a refusal",
      other.ok && other.tone === "warning" && /tagged Build \d+ only/.test(other.title),
      `${other.ok ? other.tone : "refused"} ${other.title}`,
    );

    if (plan.needs) {
      const needing = await addModOp(owner, slug, plan.needs.workshopId);
      check("one for this build that needs a mod nobody added is added too", needing.ok, needing.title);
    }

    const again = await addModOp(owner, slug, first!.workshopId);
    check("the same item twice is refused", !again.ok, again.title);
    const nonsense = await addModOp(owner, slug, "not a workshop item");
    check("and so is something that is not an item", !nonsense.ok, nonsense.title);

    const chosen = await modsView(owner, slug);
    check(`all ${many} are on the list`, chosen?.mods.length === count);
    check("the list is not what the server is running", chosen?.pending === true);
    check("and none has been downloaded yet", chosen?.awaitingDownload === count);

    console.log("\n== applied to the server ==");
    /* The new world is still generating, and the game rewrites its own
       settings file on the way up: a list written now would be lost, so
       the panel does not write it. */
    const early = await applyModsOp(owner, slug, { backup: false });
    check("while the game is still starting, nothing is written", !early.ok && /still starting/.test(early.title), early.title);
    await started(server.runtimeId!);
    const applied = await applyModsOp(owner, slug, { backup: false });
    check("once it has started, the list is written", applied.ok, applied.body);

    const written = await settings();
    check(
      `the game's own settings carry all ${many} Workshop ids`,
      keyIn(written, "WorkshopItems") ===
        [first!.workshopId, second!.workshopId, plan.other.workshopId, ...(plan.needs ? [plan.needs.workshopId] : [])].join(";"),
      keyIn(written, "WorkshopItems"),
    );
    check("and nothing is loaded yet, because nothing is downloaded yet", keyIn(written, "Mods") === "", keyIn(written, "Mods"));

    console.log("\n== the game fetches them itself, on the node ==");
    const restarted = await restartServerOp(owner, slug);
    check("the server restarts, and reads the list on its way up", restarted.ok, restarted.body);

    const arrived = () =>
      waitFor(
        async () => {
          const found = await refreshInstalledOp(owner, slug);
          const view = await modsView(owner, slug);
          return found.ok && view?.awaitingDownload === 0;
        },
        `Steam to deliver all ${many}`,
        90,
        4000,
      );
    /* Once more if it stalls. Build 41's Steam client has been seen to
       sit on a finished download for over ten minutes — "Staging library
       folder not found", over and over — and finish it in under a minute
       on the next start. That is the game's client, not the panel, and a
       restart is what an operator would do; this says when it did. */
    let downloaded = await arrived();
    if (!downloaded) {
      console.log("  …Steam stalled; one more start, as an operator would");
      await restartServerOp(owner, slug);
      downloaded = await arrived();
    }
    check(`all ${many} downloads arrive and the node says what is in them`, downloaded);

    const installed = await modsView(owner, slug);
    for (const mod of plan.loads) {
      const row = installed?.mods.find((m) => m.workshopId === mod.workshopId);
      check(
        `read off the node, not guessed: ${mod.workshopId} loads as ${mod.modId}`,
        row?.loads.includes(mod.modId) === true && row.refused.length === 0,
        JSON.stringify({ loads: row?.loads, refused: row?.refused }),
      );
    }
    const refusedRow = installed?.mods.find((m) => m.workshopId === plan.other.workshopId);
    check(
      `the other build's mod is downloaded, and ${version.label} will not load it`,
      refusedRow?.downloaded === true && refusedRow.loads.length === 0 && refusedRow.refused.some((r) => r.id === plan.other.modId),
      JSON.stringify({ loads: refusedRow?.loads, refused: refusedRow?.refused }),
    );
    check("and the row says why", refusedRow?.refused.some((r) => plan.other.refusal.test(r.reason)) === true, refusedRow?.refused[0]?.reason);
    if (plan.needs) {
      const needs = plan.needs;
      const needing = installed?.mods.find((m) => m.workshopId === needs.workshopId);
      check(
        `${needs.modId} is laid out for this build, and still not loaded: it needs ${needs.missing}`,
        needing?.downloaded === true &&
          needing.loads.length === 0 &&
          needing.refused.some((r) => r.id === needs.modId && r.reason.includes(`Needs ${needs.missing}`)),
        JSON.stringify({ loads: needing?.loads, refused: needing?.refused }),
      );
    }
    check("the tab counts what will not load", installed?.refused === refusedCount, String(installed?.refused));
    check("the list is pending again, now that there is something to load", installed?.pending === true);

    console.log("\n== loaded ==");
    /* The downloads land while the game is still on its way up — the
       race measured on 41.78.19, where the file it rewrites afterwards
       loses a Mods line written in between. So: once it has started. */
    await started(server.runtimeId!);
    const loading = await applyModsOp(owner, slug, { backup: false });
    check("the load list is written", loading.ok, loading.body);
    check("and the result says what was left out", loading.body.includes(`${refusedCount} left out of the load list`), loading.body);
    const loaded = await settings();
    check(
      "the game is told to load exactly the two this build can",
      keyIn(loaded, "Mods") === `${first!.modId};${second!.modId}`,
      keyIn(loaded, "Mods"),
    );

    const up = await restartServerOp(owner, slug);
    check("the world starts again with its mods", up.ok, up.body);
    const console1 = await started(server.runtimeId!);
    const unsaid = plan.loads.filter((mod) => !console1.includes(`loading ${mod.modId}`));
    for (const mod of plan.loads) {
      check(`the game's console says it loaded ${mod.modId}`, !unsaid.includes(mod));
    }
    if (unsaid.length > 0) {
      // What it did say, kept for whoever has to find out why.
      const kept = path.join(tmpdir(), `geeboard-verify-mods-console-${plan.build}.txt`);
      await writeFile(kept, console1);
      console.log(`  …the console it read is in ${kept}`);
    }
    check(
      "and found everything it was told to load",
      !/required mod "[^"]+" not found/.test(console1),
      console1.match(/required mod "[^"]+" not found/)?.[0],
    );
    check(`and ${plan.other.modId} was never mentioned to it`, !console1.includes(plan.other.modId));
    if (plan.needs) {
      check(`nor was ${plan.needs.modId}, which it would have skipped`, !console1.includes(plan.needs.modId));
    }

    console.log("\n== an agent on another release line is not asked ==");
    await db.node.update({ where: { name: nodeName }, data: { daemon: "0.1.9" } });
    const refused = await refreshInstalledOp(owner, slug);
    check("Ask the node refuses, and says to upgrade the agent", !refused.ok && /Upgrade the agent/.test(refused.title), refused.title);
    await db.node.update({ where: { name: nodeName }, data: { daemon: AGENT_VERSION } });

    if (plan.secondRequiresFirst) {
      console.log("\n== switched off, and required anyway ==");
      await setModEnabledOp(owner, slug, first!.workshopId, false);
      const pulled = (await modsView(owner, slug))?.mods.find((m) => m.workshopId === first!.workshopId);
      check(
        `${first!.modId} switched off says it is loaded anyway, because ${second!.modId} requires it`,
        pulled?.pulledInBy.includes(second!.modId) === true,
        JSON.stringify(pulled?.pulledInBy),
      );
      await setModEnabledOp(owner, slug, first!.workshopId, true);
    }

    console.log("\n== switched off, and taken away ==");
    const off = await setModEnabledOp(owner, slug, second!.workshopId, false);
    check("a mod can be switched off without losing its download", off.ok, off.title);
    await applyModsOp(owner, slug, { backup: false });
    const afterOff = await settings();
    check(
      "it stays in the downloads and leaves the load list",
      keyIn(afterOff, "WorkshopItems").includes(second!.workshopId) && keyIn(afterOff, "Mods") === first!.modId,
      `${keyIn(afterOff, "WorkshopItems")} | ${keyIn(afterOff, "Mods")}`,
    );

    const removed = await removeModOp(owner, slug, first!.workshopId);
    check("a mod is removed from the list", removed.ok, removed.title);
    await applyModsOp(owner, slug, { backup: false });
    const afterRemove = await settings();
    check(
      "and from what the game downloads and loads",
      !keyIn(afterRemove, "WorkshopItems").includes(first!.workshopId) && keyIn(afterRemove, "Mods") === "",
      `${keyIn(afterRemove, "WorkshopItems")} | ${keyIn(afterRemove, "Mods")}`,
    );
    check("the world's own settings are otherwise untouched", keyIn(afterRemove, "Map") === keyIn(loaded, "Map"), keyIn(afterRemove, "Map"));

    /* The same world, not a new one: the save directory the first start
       made is still the one there. The files in it are rewritten on every
       save; the directory is only made again with a new world. */
    const world = path.join(dataRoot, server.id, "Saves", "Multiplayer", "geeboard");
    const madeAt = (await stat(world).catch(() => null))?.birthtimeMs ?? null;
    check("the world was saved where the node backs it up", madeAt !== null, world);
    const back = await restartServerOp(owner, slug);
    check("and the world starts without it", back.ok, back.body);
    const console2 = await started(server.runtimeId!);
    check(`the game no longer loads ${first!.modId}`, !console2.includes(`loading ${first!.modId}`));
    check(
      "in the same world, not a new one",
      madeAt !== null && (await stat(world).catch(() => null))?.birthtimeMs === madeAt,
      String(madeAt),
    );

    console.log("\n== cleaning up ==");
    const deleted = await deleteServerOp(owner, slug, server.name);
    check("the server is deleted", deleted.ok, deleted.body);
  } finally {
    agent?.kill();
    await sweep();
    await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  }
}

const only = process.argv.includes("--build") ? process.argv[process.argv.indexOf("--build") + 1] : null;
const started_at = Date.now();
try {
  await docker.ping();
  for (const plan of PLANS.filter((p) => !only || p.build === only)) {
    const t = Date.now();
    await run(plan);
    console.log(`  (${plan.build}: ${Math.round((Date.now() - t) / 1000)} s)`);
  }
} catch (error) {
  /* A crash is a failure. The exit below is in `finally`, so without this
     a run that died halfway printed "27 passed, 0 failed" and exited 0 —
     seen when the database was reseeded under it. */
  fail++;
  console.log(`  FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  await db.$disconnect().catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed, in ${Math.round((Date.now() - started_at) / 1000)} s`);
  process.exit(fail === 0 ? 0 : 1);
}
