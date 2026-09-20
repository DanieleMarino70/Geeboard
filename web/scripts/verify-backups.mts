import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import Docker from "dockerode";
process.loadEnvFile(path.join(process.cwd(), ".env"));

/* Backups and updates, end to end and for real.

   The daemon's own suite proves an archive round-trips on disk. The
   unit tests prove the arithmetic that decides whether an update is
   offered. This proves the part neither can: that the panel, a real
   agent and real Docker together take a backup of a running server, put
   it back, move a server to another version, and go back again — with
   the rows saying what actually happened at each step.

   These are the two most destructive things the platform does. A backup
   that cannot be restored is worse than no backup, and an update with a
   rollback that does not work is worse than no update. */

const { db } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/secrets");
const { seed } = await import("../prisma/seed");
const { createServerOp } = await import("../src/lib/create-ops");
const { createBackupOp, restoreBackupOp, deleteBackupOp } = await import("../src/lib/backup-ops");
const { startServerOp, stopServerOp } = await import("../src/lib/server-ops");
const { pollOnce } = await import("../src/lib/poller");
const { rebuildServerOp, updateServerOp, rollbackServerOp } = await import("../src/lib/update-ops");
const { gameById } = await import("../src/lib/catalog");
const { syncCatalog } = await import("../src/lib/catalog-sync");
const { configureStorageOp, removeStorageOp } = await import("../src/lib/storage-ops");
const { moveServerOp } = await import("../src/lib/move-ops");
const { bucketUrl, signRequest } = await import("../src/domain/storage/s3");

/* An S3-compatible store for the off-site half: MinIO in a container,
   on a port of its own, labelled so the sweep takes it with the rest. */
const MINIO = "quay.io/minio/minio:latest";
const MINIO_PORT = 9100 + Math.floor(Math.random() * 90);
const STORE = {
  endpoint: `http://127.0.0.1:${MINIO_PORT}`,
  region: "us-east-1",
  bucket: "verify-backups",
  prefix: "geeboard",
  pathStyle: true,
  accessKeyId: "verifyminio",
  secretAccessKey: "verify-minio-secret-1",
  scheduledOffsite: true,
};

/** The keys under the prefix, asked of the store itself. */
async function objectsInBucket(): Promise<string[]> {
  const url = bucketUrl(STORE);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", `${STORE.prefix}/`);
  const signed = signRequest(STORE, "GET", url);
  const res = await fetch(signed.url, { headers: signed.headers });
  const text = await res.text();
  return [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
}

const TOKEN = "backup-token-that-is-long-enough-here!";
const PORT = 8800 + Math.floor(Math.random() * 90);
const LABEL = "gg.geeboard.verify-backups";
const ALPINE = "alpine:3.20";

/* Two versions of the same game, standing in for a real update. Both
   are the committed alpine wearing the catalogue's names, because what
   is under test is the sequence, not what Mojang ships. */
const GAME = gameById("minecraft-java")!;
const FROM = GAME.versions.find((v) => v.id === "paper-1-20-6")!;
const TO = GAME.versions.find((v) => v.id === "paper-1-21-4")!;

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
/* A second node, for the move: another agent on this machine with its
   own port, data root and container prefix, standing in for another
   machine as far as the panel can tell. */
let agent2: ChildProcess | undefined;
let dataRoot2 = "";
const PORT2 = PORT + 100;
/* What each version's tag named before the stand-in took it. On a machine
   that hosts real Minecraft servers that is the real image, and removing
   the tag at the end meant the next create pulled 1.2 GB again. */
const previousImageIds = new Map<string, string>();

async function readAt(port: number, serverId: string, at: string): Promise<string | null> {
  const res = await fetch(
    `http://127.0.0.1:${port}/servers/${serverId}/files/content?path=${encodeURIComponent(at)}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { content: string }).content;
}

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

async function sweep() {
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true, v: true }).catch(() => {});
  }
}

/** Writes a file into the server's directory through the agent. */
async function put(serverId: string, at: string, content: string) {
  const res = await fetch(
    `http://127.0.0.1:${PORT}/servers/${serverId}/files/content?path=${encodeURIComponent(at)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) throw new Error(`write ${at}: ${res.status}`);
}

async function read(serverId: string, at: string): Promise<string | null> {
  const res = await fetch(
    `http://127.0.0.1:${PORT}/servers/${serverId}/files/content?path=${encodeURIComponent(at)}`,
    { headers: { authorization: `Bearer ${TOKEN}` } },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { content: string }).content;
}

try {
  await docker.ping();
  await seed();
  await syncCatalog({ offline: true });

  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-verify-backups-"));
  await sweep();

  console.log("\n== a node that really answers ==");
  await pull(ALPINE);

  /* Both version images are the same committed alpine. An update that
     changes the image reference is enough to prove the sequence; what
     is inside it is not the point. */
  const seedContainer = await docker.createContainer({
    Image: ALPINE,
    Labels: { [LABEL]: "seed" },
    Cmd: ["sh", "-c", "while true; do sleep 1; done"],
  });
  for (const image of [FROM.image, TO.image]) {
    const previous = await docker
      .getImage(image)
      .inspect()
      .then((i) => i.Id)
      .catch(() => null);
    if (previous && !previousImageIds.has(image)) previousImageIds.set(image, previous);
    const [repo, tag] = image.split(":") as [string, string];
    await seedContainer.commit({ repo, tag });
  }
  await seedContainer.remove({ force: true });

  agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "ash-node-01",
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, "agent");
  check("the agent is up", true);

  await db.node.update({
    where: { name: "ash-node-01" },
    data: { daemonUrl: `http://127.0.0.1:${PORT}`, daemonToken: encryptSecret(TOKEN) },
  });

  const mara = await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } });

  const created = await createServerOp(mara, {
    name: "Backup Subject",
    host: "backups.ashfold.gg",
    gameId: "minecraft-java",
    versionId: FROM.id,
    templateId: "survival",
    nodeName: "ash-node-01",
    memoryGb: 2,
    cpuLimit: 100,
    diskGb: 10,
  });
  check("a server is created on it", created.ok, JSON.stringify(created));
  const slug = created.slug!;
  const server = await db.server.findUniqueOrThrow({ where: { slug } });

  /* ── Backing up ──────────────────────────────────────────────── */
  console.log("\n== a backup archives what is actually there ==");
  await put(server.id, "world/level.dat", "ORIGINAL WORLD");
  await put(server.id, "server.properties", "motd=before the backup\n");

  let r = await createBackupOp(mara, slug);
  check("the backup succeeds", r.ok, JSON.stringify(r));
  const backupId = (r as { backupId?: string }).backupId!;
  const backup = await db.backup.findUniqueOrThrow({ where: { id: backupId } });

  check("it is marked complete", backup.state === "COMPLETE", backup.state);
  check("with a real size", Number(backup.sizeBytes) > 0, String(backup.sizeBytes));
  check("and a real checksum", /^sha256:[a-f0-9]{64}$/.test(backup.checksum ?? ""), String(backup.checksum));
  check("recorded as living on the node", backup.store === "LOCAL", String(backup.store));
  check("with an artifact to point at", Boolean(backup.artifact), String(backup.artifact));
  check("and how long it took", (backup.durationMs ?? 0) >= 0, String(backup.durationMs));

  /* ── Restoring ───────────────────────────────────────────────── */
  console.log("\n== a restore puts the world back and throws away the rest ==");
  await put(server.id, "world/level.dat", "CHANGED SINCE");
  await put(server.id, "stowaway.txt", "not in the backup");

  r = await restoreBackupOp(mara, backupId);
  check("the restore succeeds", r.ok, JSON.stringify(r));
  check("the world is the one from the backup", (await read(server.id, "world/level.dat")) === "ORIGINAL WORLD");
  check(
    "and a file the backup never had is gone",
    (await read(server.id, "stowaway.txt")) === null,
    "a restore that merged would have left it",
  );

  /* ── Off-site ────────────────────────────────────────────────── */
  console.log("\n== an off-site backup lives in the bucket and nowhere else ==");
  await pull(MINIO);
  const minio = await docker.createContainer({
    Image: MINIO,
    Labels: { [LABEL]: "minio" },
    Env: [`MINIO_ROOT_USER=${STORE.accessKeyId}`, `MINIO_ROOT_PASSWORD=${STORE.secretAccessKey}`],
    Cmd: ["server", "/data"],
    HostConfig: { PortBindings: { "9000/tcp": [{ HostPort: String(MINIO_PORT) }] } },
  });
  await minio.start();
  await waitFor(async () => (await fetch(`${STORE.endpoint}/minio/health/live`)).ok, "MinIO", 120);
  // The bucket is made with the panel's own signer: a real request against a real store.
  const made = signRequest(STORE, "PUT", bucketUrl(STORE));
  check("the signer makes a bucket on MinIO", (await fetch(made.url, { method: "PUT", headers: made.headers })).ok);

  r = await configureStorageOp(mara, { ...STORE, secretAccessKey: "wrong" });
  check("wrong keys are refused, not saved", !r.ok && (await db.backupStorage.count()) === 0, JSON.stringify(r));
  r = await configureStorageOp(mara, STORE);
  check("the bucket is configured after a test upload", r.ok, JSON.stringify(r));
  check("the test object was removed again", (await objectsInBucket()).length === 0);
  check("the secret is stored encrypted", !(await db.backupStorage.findUniqueOrThrow({ where: { id: "s3" } })).secretAccessKey.includes(STORE.secretAccessKey));

  await put(server.id, "world/level.dat", "WORLD FOR THE BUCKET");
  r = await createBackupOp(mara, slug, { store: "S3" });
  check("an off-site backup succeeds", r.ok && /in verify-backups/.test(r.body), JSON.stringify(r));
  const offsiteId = (r as { backupId?: string }).backupId!;
  const offsite = await db.backup.findUniqueOrThrow({ where: { id: offsiteId } });
  check("recorded as living in the bucket", offsite.store === "S3", String(offsite.store));
  const keys = await objectsInBucket();
  check("the bucket holds it under the server's prefix", keys.length === 1 && keys[0] === `${STORE.prefix}/${server.id}/${offsite.artifact}`, keys.join(","));
  const onNode = await fetch(`http://127.0.0.1:${PORT}/servers/${server.id}/backups`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.json() as Promise<{ backups: Array<{ artifact: string }> }>);
  check("and the node kept no copy", !onNode.backups.some((b) => b.artifact === offsite.artifact), JSON.stringify(onNode));

  await put(server.id, "world/level.dat", "CHANGED AGAIN");
  r = await restoreBackupOp(mara, offsiteId);
  check("a restore pulls it down from the bucket", r.ok, JSON.stringify(r));
  check("the world is the one from the bucket", (await read(server.id, "world/level.dat")) === "WORLD FOR THE BUCKET");
  const afterRestore = await fetch(`http://127.0.0.1:${PORT}/servers/${server.id}/backups`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.json() as Promise<{ backups: Array<{ artifact: string }> }>);
  check("the copy fetched for the restore is gone again", !afterRestore.backups.some((b) => b.artifact === offsite.artifact));

  r = await createBackupOp(mara, slug, { trigger: "SCHEDULED" });
  check("a scheduled backup follows the storage setting off-site", r.ok && (await db.backup.findUniqueOrThrow({ where: { id: (r as { backupId?: string }).backupId! } })).store === "S3", JSON.stringify(r));
  check("two objects now", (await objectsInBucket()).length === 2);
  const { pruneBackups: prune } = await import("../src/lib/server-ops");
  check("retention removes the older one from the bucket", (await prune(server.id, 1)) >= 1 && (await objectsInBucket()).length === 1);
  const lastOffsite = await db.backup.findFirstOrThrow({ where: { serverId: server.id, store: "S3" } });
  r = await deleteBackupOp(mara, lastOffsite.id);
  check("deleting an off-site backup removes the object", r.ok && (await objectsInBucket()).length === 0, JSON.stringify(r));

  /* ── Moving ──────────────────────────────────────────────────── */
  console.log("\n== a move carries the server to another node through the bucket ==");
  dataRoot2 = await mkdtemp(path.join(tmpdir(), "geeboard-verify-backups-2-"));
  agent2 = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(process.cwd(), "..", "daemon"),
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT2),
      GEEBOARD_NODE_NAME: "fra-node-02",
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot2,
      // Same Docker engine as the first agent: names must not collide.
      GEEBOARD_CONTAINER_PREFIX: "geeboard-verify2-",
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT2}/health`)).ok, "second agent");
  const fra = await db.node.update({
    where: { name: "fra-node-02" },
    data: { daemonUrl: `http://127.0.0.1:${PORT2}`, daemonToken: encryptSecret(TOKEN), approvedAt: new Date(), state: "HEALTHY" },
  });
  const ash = await db.node.findUniqueOrThrow({ where: { name: "ash-node-01" } });

  await put(server.id, "world/level.dat", "WORLD THAT MOVES");
  const before = await db.server.findUniqueOrThrow({ where: { slug } });
  r = await moveServerOp(mara, slug, "fra-node-02");
  check("the move succeeds", r.ok && /moved to fra-node-02/.test(r.title), JSON.stringify(r));
  const moved = await db.server.findUniqueOrThrow({ where: { slug } });
  check("the row points at the second node", moved.nodeId === fra.id && moved.runtimeId !== before.runtimeId);
  check("and it is running there", Boolean(moved.runtimeId) && (await docker.getContainer(moved.runtimeId!).inspect()).State.Running);
  check("with its world, readable through the second agent", (await readAt(PORT2, server.id, "world/level.dat")) === "WORLD THAT MOVES");
  check("the old workload is gone", await docker.getContainer(before.runtimeId!).inspect().then(() => false, () => true));
  check("and the old directory with it", (await readAt(PORT, server.id, "world/level.dat")) === null);
  check("the move left an off-site backup", (await objectsInBucket()).some((k) => k.includes("-move-")));
  check("and an audit event naming both nodes",
    Boolean(await db.activityEvent.findFirst({ where: { serverId: server.id, action: "server.moved" } })));

  r = await moveServerOp(mara, slug, "fra-node-02");
  check("moving to the node it is on is refused", !r.ok && r.title === "Already there", JSON.stringify(r));

  r = await moveServerOp(mara, slug, "ash-node-01");
  check("and it moves back", r.ok, JSON.stringify(r));
  const returned = await db.server.findUniqueOrThrow({ where: { slug } });
  check("on the first node again, running, world intact",
    returned.nodeId === ash.id && (await readAt(PORT, server.id, "world/level.dat")) === "WORLD THAT MOVES");
  // The two move backups are ordinary off-site backups now; the sections below expect none.
  for (const b of await db.backup.findMany({ where: { serverId: server.id, store: "S3" } })) {
    await deleteBackupOp(mara, b.id);
  }
  check("the move backups can be deleted like any other", (await objectsInBucket()).length === 0);

  r = await removeStorageOp(mara);
  check("the bucket can be forgotten", r.ok && (await db.backupStorage.count()) === 0, JSON.stringify(r));
  r = await createBackupOp(mara, slug, { store: "S3" });
  check("and an off-site backup is then refused, not silently made local", !r.ok && /No off-site storage/.test(r.title), JSON.stringify(r));
  /* Retention above took the older local backup with it; the sections
     below expect an unlocked one to exist, so one is taken again. */
  r = await createBackupOp(mara, slug);
  check("a local backup is still taken as before", r.ok && /on ash-node-01/.test(r.body), JSON.stringify(r));

  /* ── Updating ────────────────────────────────────────────────── */
  console.log("\n== an update backs up first, then moves the version ==");
  const backupsBefore = await db.backup.count({ where: { serverId: server.id } });
  await put(server.id, "world/level.dat", "WORLD BEFORE THE UPDATE");

  r = await updateServerOp(mara, slug, TO.id);
  check("the update succeeds", r.ok, JSON.stringify(r));

  const updated = await db.server.findUniqueOrThrow({ where: { slug } });
  check("the version moved", updated.version === TO.label, updated.version);
  check("a backup was taken on the way", (await db.backup.count({ where: { serverId: server.id } })) === backupsBefore + 1);

  const preUpdate = await db.backup.findFirstOrThrow({
    where: { serverId: server.id, trigger: "PRE_UPDATE" },
  });
  check("it is marked as a pre-update backup", preUpdate.trigger === "PRE_UPDATE");
  check(
    "and locked, so retention cannot take the way back",
    preUpdate.state === "LOCKED",
    preUpdate.state,
  );

  check("the way back was recorded", updated.rollbackVersionLabel === FROM.label, String(updated.rollbackVersionLabel));
  check("pointing at that backup", updated.rollbackBackupId === preUpdate.id);
  check("the world survived the rebuild", (await read(server.id, "world/level.dat")) === "WORLD BEFORE THE UPDATE");
  check("and it is running the new workload", (await docker.getContainer(updated.runtimeId!).inspect()).State.Running);

  /* Two things the API will be asked for and the panel never offers.
     Both must be refused before the backup — a refusal that stops the
     server first has already done the damage it was refusing. */
  const backupsNow = await db.backup.count({ where: { serverId: server.id } });
  r = await updateServerOp(mara, slug, FROM.id);
  check("going back down a version is refused", !r.ok && r.body.includes("older"), JSON.stringify(r));
  r = await updateServerOp(mara, slug, "fabric-1-21-4");
  check("switching Paper for Fabric is refused", !r.ok && r.body.includes("different line"), JSON.stringify(r));
  check(
    "and neither took a backup or stopped anything",
    (await db.backup.count({ where: { serverId: server.id } })) === backupsNow &&
      (await docker.getContainer(updated.runtimeId!).inspect()).State.Running,
  );

  /* A locked backup is not something a cleanup may take. This is the
     assertion that makes "rolling back is possible" mean something: a
     retention policy set to keep nothing still keeps this one. */
  const { pruneBackups } = await import("../src/lib/server-ops");
  const swept = await pruneBackups(server.id, 0);
  check("a cleanup that keeps nothing still runs", swept >= 1, `removed ${swept}`);
  check(
    "but it cannot delete the way back",
    (await db.backup.findUnique({ where: { id: preUpdate.id } })) !== null,
  );
  check(
    "and everything unlocked went",
    (await db.backup.count({ where: { serverId: server.id, state: { not: "LOCKED" } } })) === 0,
  );

  /* ── Rolling back ────────────────────────────────────────────── */
  console.log("\n== rolling back restores both the version and the world ==");
  await put(server.id, "world/level.dat", "WORLD AFTER THE UPDATE");

  r = await rollbackServerOp(mara, slug);
  check("the rollback succeeds", r.ok, JSON.stringify(r));

  const back = await db.server.findUniqueOrThrow({ where: { slug } });
  check("the version went back", back.version === FROM.label, back.version);
  check(
    "and so did the world",
    (await read(server.id, "world/level.dat")) === "WORLD BEFORE THE UPDATE",
  );
  check("there is no second way back", back.rollbackBackupId === null, String(back.rollbackBackupId));
  check(
    "and the backup is unlocked again",
    (await db.backup.findUniqueOrThrow({ where: { id: preUpdate.id } })).state !== "LOCKED",
  );

  console.log("\n== refusals ==");
  r = await rollbackServerOp(mara, slug);
  check("rolling back twice is refused", !r.ok, JSON.stringify(r));

  r = await updateServerOp(mara, slug, FROM.id);
  check("updating to the version it is on is refused", !r.ok, JSON.stringify(r));

  r = await updateServerOp(mara, slug, "no-such-version");
  check("an unknown version is refused", !r.ok, JSON.stringify(r));

  /* A fresh one: the first backup was swept by the retention check
     above, and deleting something already gone proves nothing. */
  const fresh = await createBackupOp(mara, slug);
  const freshId = (fresh as { backupId?: string }).backupId!;
  r = await deleteBackupOp(mara, freshId);
  check("an ordinary backup deletes", r.ok, JSON.stringify(r));
  check("and its row is gone", (await db.backup.findUnique({ where: { id: freshId } })) === null);

  /* The archive goes with it. A row that disappears while its bytes sit
     on the node forever is how a disk fills up with backups nobody can
     see. */
  const remaining = await fetch(`http://127.0.0.1:${PORT}/servers/${server.id}/backups`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }).then((res) => res.json() as Promise<{ backups: Array<{ artifact: string }> }>);
  check(
    "and so is the archive on the node",
    !remaining.backups.some((b) => b.artifact.includes("manual")),
    remaining.backups.map((b) => b.artifact).join(", "),
  );

  console.log("\n== an update whose new workload will not start keeps the world ==");
  /* The installer cleans up a failed install. It used to clean up the
     server's directory too — right for a new server, and for an update
     it meant a workload that would not start took the world with it,
     and since archives go with the data, the locked pre-update backup
     as well. A port held by something outside the panel is the honest
     way to make the new workload fail after it exists. */
  await put(server.id, "world/level.dat", "WORLD THAT MUST SURVIVE");
  r = await stopServerOp(mara, slug);
  check("the server is stopped first, so its port is free to take", r.ok, JSON.stringify(r));

  const port = (await db.server.findUniqueOrThrow({ where: { id: server.id } })).port;
  const squatter = await docker.createContainer({
    Image: ALPINE,
    Labels: { [LABEL]: "squatter" },
    Cmd: ["sh", "-c", "while true; do sleep 1; done"],
    ExposedPorts: { "9000/tcp": {} },
    HostConfig: { PortBindings: { "9000/tcp": [{ HostPort: String(port) }] } },
  });
  await squatter.start();

  const archivesBefore = await fetch(`http://127.0.0.1:${PORT}/servers/${server.id}/backups`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }).then((res) => res.json() as Promise<{ backups: unknown[] }>);

  r = await updateServerOp(mara, slug, TO.id);
  check("the update fails", !r.ok, JSON.stringify(r));

  check(
    "the world is still there",
    (await read(server.id, "world/level.dat")) === "WORLD THAT MUST SURVIVE",
  );
  const archivesAfter = await fetch(`http://127.0.0.1:${PORT}/servers/${server.id}/backups`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }).then((res) => res.json() as Promise<{ backups: unknown[] }>);
  check(
    "and so are its backups, including the one this update took",
    archivesAfter.backups.length === archivesBefore.backups.length + 1,
    `${archivesBefore.backups.length} before, ${archivesAfter.backups.length} after`,
  );
  const failed = await db.server.findUniqueOrThrow({ where: { id: server.id } });
  check("the server says the update failed", failed.state === "ERROR" && /Update failed/.test(failed.lastError ?? ""), `${failed.state}: ${failed.lastError}`);
  /* The old workload was destroyed on the way; a row still naming it was
     found missing by the next poll and blamed on somebody outside the
     panel, over the reason the update gave. */
  check("with no workload recorded, since the old one was destroyed", failed.runtimeId === null, String(failed.runtimeId));

  await squatter.remove({ force: true });

  let pass1 = await pollOnce();
  check("a poll pass has nothing to report about it", pass1.workloadsMissing === 0 && pass1.errors.length === 0, JSON.stringify(pass1));
  check(
    "and leaves the reason alone",
    /Update failed/.test((await db.server.findUniqueOrThrow({ where: { id: server.id } })).lastError ?? ""),
  );

  console.log("\n== a server with no workload is rebuilt ==");
  /* Start used to fall through to the simulator for a server with no
     workload, and call a server with nothing behind it RUNNING. */
  r = await startServerOp(mara, slug);
  check("starting it is refused, pointing at a rebuild", !r.ok && /Rebuild/.test(r.body), JSON.stringify(r));
  check("rather than simulating a start", (await db.server.findUniqueOrThrow({ where: { id: server.id } })).state === "ERROR");

  r = await rebuildServerOp(mara, slug);
  check("rebuilding it works", r.ok, JSON.stringify(r));
  const rebuilt = await db.server.findUniqueOrThrow({ where: { id: server.id } });
  check("it has a new workload", Boolean(rebuilt.runtimeId));
  check("running, since it was not stopped on purpose", rebuilt.state === "RUNNING", rebuilt.state);
  check("with its error cleared", rebuilt.lastError === null, String(rebuilt.lastError));
  check("on the version it was on", rebuilt.version === failed.version, rebuilt.version);
  check("Docker agrees", (await docker.getContainer(rebuilt.runtimeId!).inspect()).State.Running);
  check("and the world is the one it had", (await read(server.id, "world/level.dat")) === "WORLD THAT MUST SURVIVE");

  console.log("\n== a container removed outside the panel is noticed ==");
  /* The case as it happened on a real machine: the container removed by
     something other than the panel, the world left behind. The poller
     used to report the missing container as an error line on every
     pass, forever. */
  await docker.getContainer(rebuilt.runtimeId!).remove({ force: true });
  pass1 = await pollOnce();
  const missing = await db.server.findUniqueOrThrow({ where: { id: server.id } });
  check("the poller notices the workload is gone", pass1.workloadsMissing === 1, JSON.stringify(pass1));
  check("and does not report it as an error", pass1.errors.length === 0, pass1.errors.join("; "));
  check("the server is ERROR, naming what happened", missing.state === "ERROR" && /outside the panel/.test(missing.lastError ?? ""), `${missing.state}: ${missing.lastError}`);
  check("with no workload recorded", missing.runtimeId === null);
  check(
    "and the event is in the activity log",
    Boolean(await db.activityEvent.findFirst({ where: { serverId: server.id, action: "server.workload.missing" } })),
  );
  check("a second pass says nothing more", (await pollOnce()).workloadsMissing === 0);
  check("its files still there", (await read(server.id, "world/level.dat")) === "WORLD THAT MUST SURVIVE");

  r = await rebuildServerOp(mara, slug);
  check("and a rebuild brings it back", r.ok && Boolean((await db.server.findUniqueOrThrow({ where: { id: server.id } })).runtimeId), JSON.stringify(r));

  console.log("\n== a stopped server rebuilt on its version is not started ==");
  /* It used to be started and stopped again, which for a game that ignores
     the stop signal was thirty seconds and a kill during boot. */
  r = await stopServerOp(mara, slug);
  check("stopped first", r.ok, JSON.stringify(r));
  r = await rebuildServerOp(mara, slug);
  check("the rebuild works", r.ok && /left stopped/.test(r.body), JSON.stringify(r));
  const quiet = await db.server.findUniqueOrThrow({ where: { id: server.id } });
  check("the server is still STOPPED", quiet.state === "STOPPED", quiet.state);
  const inspected = await docker.getContainer(quiet.runtimeId!).inspect();
  check(
    "and its new workload has never run",
    !inspected.State.Running && inspected.State.StartedAt.startsWith("0001-"),
    `${inspected.State.Status} ${inspected.State.StartedAt}`,
  );
} finally {
  agent?.kill();
  agent2?.kill();
  await sweep();
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  if (dataRoot2) await rm(dataRoot2, { recursive: true, force: true }).catch(() => {});
  // Put back whatever each tag was pointing at, or remove it.
  for (const image of new Set([FROM.image, TO.image])) {
    await docker.getImage(image).remove({ force: true }).catch(() => {});
    const previous = previousImageIds.get(image);
    if (previous) {
      const [repo, tag] = image.split(":") as [string, string];
      await docker.getImage(previous).tag({ repo, tag }).catch(() => {});
    }
  }
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
