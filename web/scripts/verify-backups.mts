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
const { updateServerOp, rollbackServerOp } = await import("../src/lib/update-ops");
const { gameById } = await import("../src/lib/catalog");
const { syncCatalog } = await import("../src/lib/catalog-sync");

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
} finally {
  agent?.kill();
  await sweep();
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
  for (const image of [FROM.image, TO.image]) {
    await docker.getImage(image).remove({ force: true }).catch(() => {});
  }
  await seed();
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
