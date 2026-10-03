import "./load-env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";

/* Saved templates, and cloning a server — with its world.

   The templates half is the operations against the database: what is kept of
   a server and what is left behind, the wizard's start from one, a create that
   says where its settings came from. The clone half is the whole path for real:
   a real agent and two real containers, a bucket stood in for by a small S3 on
   127.0.0.1, a backup of the source into it and a restore into the new server,
   and the file that was in one world read from the other. */

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { encryptSecret } = await import("../src/lib/secrets");
const { createServerOp } = await import("../src/lib/create-ops");
const { configureStorageOp, removeStorageOp } = await import("../src/lib/storage-ops");
const tpl = await import("../src/lib/template-ops");

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

const TOKEN = "templates-agent-token-long-enough-ok!!";
const PORT = 8900 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.templates";
const IMAGE = "alpine:3.20";
const docker = new Docker();
const dataRoot = mkdtempSync(path.join(tmpdir(), "gb-templates-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let agent: ChildProcess | undefined;
const containers: Docker.Container[] = [];

async function waitFor(fn: () => Promise<boolean>, label: string, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* The bucket: PUT keeps the body, GET and HEAD serve it, DELETE drops it. */
const objects = new Map<string, Buffer>();
const s3 = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const key = (req.url ?? "").split("?")[0]!;
    if (req.method === "PUT") {
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { etag: '"x"' });
      return res.end();
    }
    const body = objects.get(key);
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  });
});
await new Promise<void>((resolve) => s3.listen(0, "127.0.0.1", resolve));
const s3Port = (s3.address() as AddressInfo).port;
const form = {
  endpoint: `http://127.0.0.1:${s3Port}`,
  region: "us-east-1",
  bucket: "verify-templates",
  prefix: "geeboard",
  pathStyle: true,
  accessKeyId: "verifykey",
  secretAccessKey: "verify-templates-secret-1",
  scheduledOffsite: false,
};

try {
  await seed();
  await syncCatalog({ offline: true });
  await db.backupStorage.deleteMany();
  await db.serverTemplate.deleteMany();
  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });
  const moderator = await db.user.findFirstOrThrow({ where: { role: "MODERATOR" } });

  console.log("\n== a template is saved from a server, without what belongs to that server ==");
  const made = await createServerOp(mara, {
    name: "Hardcore Terraria",
    host: "hardcore.ashfold.gg",
    gameId: "terraria",
    versionId: "vanilla-1-4-5-8",
    templateId: "classic",
    config: { difficulty: "2", password: "hunter2", worldFile: "mine.wld", maxPlayers: 12 },
    nodeName: "ash-node-01",
    memoryGb: 2,
    cpuLimit: 150,
    diskGb: 8,
  });
  check("a server with a password and a world file of its own exists", made.ok, JSON.stringify(made));
  const source = await db.server.findUniqueOrThrow({ where: { slug: "hardcore-terraria" } });
  check("whose settings do hold the password and the world file", JSON.stringify(source.config).includes("hunter2") && JSON.stringify(source.config).includes("mine.wld"));

  const nope = await tpl.saveTemplateOp(moderator, source.slug, "Mine");
  check("a moderator may not save a template", !nope.ok && nope.title === "Not permitted");
  const bad = await tpl.saveTemplateOp(mara, source.slug, "x");
  check("a name of one character is refused", !bad.ok && bad.title === "Check the form");
  const saved = await tpl.saveTemplateOp(mara, source.slug, "Hardcore weekend");
  check("it is saved, saying what it did not keep", saved.ok && /not (World file or Server password|Server password or World file)/.test(saved.body), JSON.stringify(saved));
  const row = await db.serverTemplate.findFirstOrThrow({ where: { name: "Hardcore weekend" } });
  check("the settings that travel are in it, as they were", (row.config as Record<string, unknown>).difficulty === "2" && (row.config as Record<string, unknown>).maxPlayers === 12, JSON.stringify(row.config));
  check("the password and the world file are not, anywhere in the row", !JSON.stringify(row).includes("hunter2") && !JSON.stringify(row).includes("mine.wld"));
  check("with the limits and the version it was saved at", row.memoryGb === 2 && row.cpuLimit === 150 && row.diskGb === 8 && row.versionLabel === source.version && row.sourceName === source.name, JSON.stringify([row.memoryGb, row.cpuLimit, row.diskGb, row.versionLabel]));
  const same = await tpl.saveTemplateOp(mara, source.slug, "Hardcore weekend");
  check("a second one of the same name for the same game is refused", !same.ok && same.title === "Name in use");
  check("the audit says it was saved, from which server, and how many settings", (await db.activityEvent.count({ where: { action: "template.saved", target: "Hardcore weekend" } })) === 1);
  check("and holds no value of any setting", !JSON.stringify(await db.activityEvent.findMany({ where: { action: "template.saved" } })).includes("hunter2"));

  console.log("\n== the list, and the wizard's start ==");
  const list = await tpl.templatesView();
  check("the list shows it by name, game and summary", list.length === 1 && list[0]!.name === "Hardcore weekend" && list[0]!.gameName === "Terraria" && /settings · 2 GB memory · 150% CPU · 8 GB disk/.test(list[0]!.summary), JSON.stringify(list));
  const start = await tpl.templateStart(mara, row.id);
  check("a template opens the wizard on its game, version and limits", start !== null && start.gameId === "terraria" && start.versionId === "vanilla-1-4-5-8" && start.memoryGb === 2 && start.cpuLimit === 150 && start.diskGb === 8, JSON.stringify(start));
  check("with its settings, and no password and no world file", start !== null && start.config.difficulty === "2" && !("password" in start.config) && !("worldFile" in start.config), JSON.stringify(start?.config));
  check("saying where it came from", start?.origin.kind === "template" && start.origin.name === "Hardcore weekend" && start.clone === null && start.versionNote === null);
  check("and nobody who may not create a server is given one", (await tpl.templateStart(moderator, row.id)) === null);
  await db.serverTemplate.update({ where: { id: row.id }, data: { versionSlug: "a-version-that-is-gone", versionLabel: "0.1.0" } });
  const retired = await tpl.templateStart(mara, row.id);
  check("a version the game no longer offers is replaced by its default, and the page says so", retired !== null && retired.versionNote !== null && /0\.1\.0/.test(retired.versionNote) && retired.versionId.length > 0, JSON.stringify(retired?.versionNote));
  await db.serverTemplate.update({ where: { id: row.id }, data: { versionSlug: source.version === "" ? null : "vanilla-1-4-5-8", versionLabel: source.version } });

  console.log("\n== a create from it says so, and a server is not tied to the template afterwards ==");
  const fromTemplate = await createServerOp(mara, {
    name: "Second Hardcore",
    host: "second.ashfold.gg",
    gameId: "terraria",
    versionId: start!.versionId,
    templateId: "classic",
    config: start!.config,
    nodeName: "ash-node-01",
    memoryGb: start!.memoryGb,
    cpuLimit: start!.cpuLimit,
    diskGb: start!.diskGb,
    origin: { kind: "template", id: row.id },
  });
  check("the create goes through with the template's values", fromTemplate.ok, JSON.stringify(fromTemplate));
  const second = await db.server.findUniqueOrThrow({ where: { slug: "second-hardcore" } });
  check("the server has the template's difficulty and limits", (second.config as Record<string, unknown>).difficulty === "2" && second.memoryLimit === 2, JSON.stringify(second.config));
  const createdEvent = await db.activityEvent.findFirst({ where: { action: "server.created.simulated", target: "Second Hardcore" } });
  check("the audit line says it was made from the template, by name", JSON.stringify(createdEvent?.changes).includes("template Hardcore weekend"), JSON.stringify(createdEvent?.changes));
  const noOrigin = await db.activityEvent.findFirst({ where: { action: "server.created.simulated", target: "Hardcore Terraria" } });
  check("one made without an origin has no such line", !JSON.stringify(noOrigin?.changes).includes("From"));
  const forged = await createServerOp(mara, { name: "Forged Origin", host: "forged.ashfold.gg", gameId: "terraria", versionId: "vanilla-1-4-5-8", templateId: "classic", nodeName: "ash-node-01", memoryGb: 1, cpuLimit: 50, diskGb: 5, origin: { kind: "template", id: "made-up" } });
  check("an origin that names nothing is ignored, not believed", forged.ok && !JSON.stringify((await db.activityEvent.findFirst({ where: { target: "Forged Origin", action: "server.created.simulated" } }))?.changes).includes("From"));
  const deleted = await tpl.deleteTemplateOp(mara, row.id);
  check("deleting the template leaves the server made from it as it is", deleted.ok && (await db.server.findUniqueOrThrow({ where: { slug: "second-hardcore" } })).memoryLimit === 2 && (await db.serverTemplate.count()) === 0, JSON.stringify(deleted));
  check("a moderator may not delete one, and one already gone says so", !(await tpl.deleteTemplateOp(moderator, row.id)).ok && (await tpl.deleteTemplateOp(mara, row.id)).title === "No such template");

  console.log("\n== a clone starts from a server, and keeps the file its world needs ==");
  const clone = await tpl.cloneStart(mara, source.slug);
  check("it opens the wizard filled in from the server, named as a copy", clone !== null && clone.name === "Hardcore Terraria copy" && clone.origin.kind === "clone" && clone.origin.id === source.slug && clone.memoryGb === 2, JSON.stringify(clone));
  check("with the world file, which the restored world will have, and no password", clone !== null && clone.config.worldFile === "mine.wld" && !("password" in clone.config), JSON.stringify(clone?.config));
  check("with no bucket it says the world cannot travel", clone !== null && clone.clone !== null && !clone.clone.canCopyWorld && /no off-site bucket/.test(clone.clone.note), JSON.stringify(clone?.clone));
  const noBucket = await tpl.cloneWorldOp(mara, source.slug, "second-hardcore");
  check("copying a world with no bucket is refused, and nothing is deleted", !noBucket.ok && noBucket.title === "No off-site storage");
  check("a server is not its own copy, and a moderator may not clone", !(await tpl.cloneWorldOp(mara, source.slug, source.slug)).ok && !(await tpl.cloneWorldOp(moderator, source.slug, "second-hardcore")).ok);

  console.log("\n== the world, for real: a backup of one server into the bucket and a restore into the other ==");
  await new Promise<void>((resolve, reject) => {
    docker.pull(IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) await docker.getContainer(c.Id).remove({ force: true });
  for (const n of ["a", "b"]) {
    const c = await docker.createContainer({
      Image: IMAGE,
      name: `geeboard-templates-${n}-${Date.now()}`,
      Labels: { [LABEL]: "1" },
      OpenStdin: true,
      Tty: false,
      HostConfig: { Memory: 128 * 1024 * 1024 },
      Cmd: ["sh", "-c", 'echo up; while read l; do echo "recv: $l"; done'],
    });
    await c.start();
    containers.push(c);
  }
  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: { ...process.env, GEEBOARD_DAEMON_TOKEN: TOKEN, GEEBOARD_DAEMON_PORT: String(PORT), GEEBOARD_NODE_NAME: "fra-node-02", GEEBOARD_MANAGED_LABEL: LABEL, GEEBOARD_DATA_ROOT: dataRoot },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");
  await db.node.update({ where: { name: "fra-node-02" }, data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN), state: "HEALTHY", lastSeenAt: new Date(), lastReachedAt: new Date() } });

  // Two servers of one game on the node with the agent, each with a container and a world of its own on disk.
  type CreateData = Parameters<typeof db.server.create>[0]["data"];
  const model = await db.server.findUniqueOrThrow({ where: { slug: "aurora" } });
  const copyOf = (slug: string, name: string, host: string, port: number, runtimeId: string): CreateData => {
    const base: Record<string, unknown> = { ...model };
    for (const k of ["id", "createdAt", "updatedAt"]) delete base[k];
    return { ...base, slug, name, host, port, runtimeId, state: "RUNNING" } as unknown as CreateData;
  };
  await db.server.update({ where: { id: model.id }, data: { runtimeId: containers[0]!.id, state: "RUNNING" } });
  const target = await db.server.create({ data: copyOf("aurora-copy", "Aurora copy", "aurora-copy.ashfold.gg", model.port + 31, containers[1]!.id) });
  const folder = (id: string) => path.join(dataRoot, id);
  mkdirSync(path.join(folder(model.id), "world"), { recursive: true });
  mkdirSync(path.join(folder(target.id), "world"), { recursive: true });
  writeFileSync(path.join(folder(model.id), "world", "level.dat"), "the world of Aurora SMP");
  writeFileSync(path.join(folder(model.id), "server.properties"), "motd=Aurora");
  writeFileSync(path.join(folder(target.id), "world", "level.dat"), "a new world, made on creation");
  writeFileSync(path.join(folder(target.id), "stray.txt"), "left over from the new world");

  const bucket = await configureStorageOp(mara, form);
  check("the stand-in bucket is accepted (a store on this machine is allowed)", bucket.ok, JSON.stringify(bucket));
  const withBucket = await tpl.cloneStart(mara, "aurora");
  check("with a bucket the wizard offers to copy the world", withBucket?.clone?.canCopyWorld === true && /off-site bucket/.test(withBucket.clone.note));

  const other = await tpl.cloneWorldOp(mara, "aurora", "hardcore-terraria");
  check("a server of another game is refused: a world of one is not a world of the other", !other.ok && other.title === "A different game", JSON.stringify(other));

  const copied = await tpl.cloneWorldOp(mara, "aurora", "aurora-copy");
  check("the world is copied", copied.ok, JSON.stringify(copied));
  const read = (id: string, file: string) => {
    try {
      return readFileSync(path.join(folder(id), file), "utf8");
    } catch {
      return null;
    }
  };
  check("the file that was in the source's world is now in the new server's", read(target.id, "world/level.dat") === "the world of Aurora SMP", String(read(target.id, "world/level.dat")));
  check("and the rest of the source's folder came with it", read(target.id, "server.properties") === "motd=Aurora");
  check("a restore replaces and does not merge: what the new world had left over is gone", read(target.id, "stray.txt") === null);
  check("the source was not touched, and was not stopped", read(model.id, "world/level.dat") === "the world of Aurora SMP" && (await containers[0]!.inspect()).State.Running === true);
  check("the archive went through the bucket", [...objects.keys()].some((k) => /clone/.test(k)), [...objects.keys()].join(","));
  const events = await db.activityEvent.findMany({ where: { action: "server.cloned" } });
  check("the audit log says the world was copied, from which server", events.length === 1 && JSON.stringify(events[0]!.changes).includes("copied") && JSON.stringify(events[0]!.changes).includes("Aurora SMP"), JSON.stringify(events));

  await removeStorageOp(mara);
} finally {
  agent?.kill();
  for (const c of containers) await c.remove({ force: true, v: true }).catch(() => {});
  s3.closeAllConnections();
  s3.close();
  rmSync(dataRoot, { recursive: true, force: true });
  await db.backupStorage.deleteMany().catch(() => {});
  await db.serverTemplate.deleteMany().catch(() => {});
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
