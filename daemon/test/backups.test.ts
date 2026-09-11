import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  backupRoot,
  createArchive,
  listArchives,
  removeArchive,
  restoreArchive,
  verifyArchive,
} from "../src/backups.ts";

/* The archive format, round-tripped.

   Worth testing carefully rather than trusting: a backup that cannot be
   restored is worse than no backup at all, because somebody stopped
   worrying on the strength of it. Every test here writes real files,
   archives them, throws the originals away and checks what comes back. */

const SERVER = "srv-archive-test";
let dataRoot: string;

async function seedWorld() {
  const root = path.join(dataRoot, SERVER);
  await mkdir(path.join(root, "world", "region"), { recursive: true });
  await writeFile(path.join(root, "server.properties"), "max-players=20\nmotd=hello\n");
  await writeFile(path.join(root, "world", "level.dat"), Buffer.from([0x1f, 0x00, 0xff, 0x42]));
  await writeFile(path.join(root, "world", "region", "r.0.0.mca"), "x".repeat(5000));
  await writeFile(path.join(root, "empty.txt"), "");
  return root;
}

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-backups-"));
});

after(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

test("an archive round-trips a world exactly", async () => {
  const root = await seedWorld();
  const result = await createArchive(dataRoot, SERVER, "nightly");

  assert.match(result.artifact, /^nightly\.tar\.gz$/);
  assert.ok(result.sizeBytes > 0);
  assert.match(result.checksum, /^sha256:[a-f0-9]{64}$/);

  // Throw the originals away, exactly as a real restore would find.
  await rm(root, { recursive: true, force: true });

  const restored = await restoreArchive(dataRoot, SERVER, result.artifact);
  assert.ok(restored.files >= 4);

  assert.equal(
    await readFile(path.join(root, "server.properties"), "utf8"),
    "max-players=20\nmotd=hello\n",
  );
  // Binary content has to survive byte for byte; a world file is not text.
  assert.deepEqual(
    [...(await readFile(path.join(root, "world", "level.dat")))],
    [0x1f, 0x00, 0xff, 0x42],
  );
  assert.equal((await readFile(path.join(root, "world", "region", "r.0.0.mca"), "utf8")).length, 5000);
  assert.equal(await readFile(path.join(root, "empty.txt"), "utf8"), "");
});

test("the checksum describes the bytes that were written", async () => {
  await seedWorld();
  const result = await createArchive(dataRoot, SERVER, "checked");

  const verified = await verifyArchive(dataRoot, SERVER, result.artifact);
  assert.equal(verified.checksum, result.checksum);
  assert.equal(verified.sizeBytes, result.sizeBytes);
});

test("a restore refuses an archive that does not match its checksum", async () => {
  await seedWorld();
  const result = await createArchive(dataRoot, SERVER, "tampered");

  await assert.rejects(
    restoreArchive(dataRoot, SERVER, result.artifact, "sha256:" + "0".repeat(64)),
    /does not match the checksum/,
  );
});

test("a restore replaces rather than merges", async () => {
  const root = await seedWorld();
  const result = await createArchive(dataRoot, SERVER, "clean");

  // Something that was not in the backup — a corrupt region, a plugin
  // added since. A restore that merged would leave it behind, and the
  // point of a restore is a state that is known.
  await writeFile(path.join(root, "stowaway.txt"), "should not survive");

  await restoreArchive(dataRoot, SERVER, result.artifact);
  await assert.rejects(readFile(path.join(root, "stowaway.txt")));
});

test("symlinks are skipped rather than followed", async () => {
  const root = await seedWorld();
  const outside = path.join(dataRoot, "not-mine.txt");
  await writeFile(outside, "somebody else's data");

  try {
    await symlink(outside, path.join(root, "escape.txt"));
  } catch {
    // Windows without developer mode cannot make one; nothing to test.
    return;
  }

  const result = await createArchive(dataRoot, SERVER, "links");
  await rm(root, { recursive: true, force: true });
  await restoreArchive(dataRoot, SERVER, result.artifact);

  /* Following it would have copied a file from outside the server's
     directory into its backup — and a loop would never have finished. */
  await assert.rejects(readFile(path.join(root, "escape.txt")));
});

test("archives live beside a server's data, never inside it", async () => {
  const root = path.join(dataRoot, SERVER);
  const backups = backupRoot(dataRoot, SERVER);

  // Inside would mean each backup archives the previous ones, and the
  // directory doubling every night until the disk is full.
  assert.equal(backups.startsWith(root + path.sep), false);
});

test("listing and deleting an archive", async () => {
  await seedWorld();
  const result = await createArchive(dataRoot, SERVER, "disposable");

  const before = await listArchives(dataRoot, SERVER);
  assert.ok(before.some((b) => b.artifact === result.artifact));

  await removeArchive(dataRoot, SERVER, result.artifact);
  const after = await listArchives(dataRoot, SERVER);
  assert.equal(
    after.some((b) => b.artifact === result.artifact),
    false,
  );
});

test("a missing archive is a not-found, not a crash", async () => {
  await assert.rejects(verifyArchive(dataRoot, SERVER, "nothing.tar.gz"), /no such archive/);
  await assert.rejects(removeArchive(dataRoot, SERVER, "nothing.tar.gz"), /no such archive/);
});

test("an artifact name that is a path is refused", async () => {
  for (const name of ["../escape.tar.gz", "/etc/passwd.tar.gz", "..\\up.tar.gz", "plain.txt"]) {
    await assert.rejects(verifyArchive(dataRoot, SERVER, name), /not a valid archive name/, name);
  }
});

test("a server id that is a path is refused before it becomes one", async () => {
  await assert.rejects(createArchive(dataRoot, "../../etc", "x"), /invalid server id/);
});

test("archiving a server with no data directory is a not-found", async () => {
  await assert.rejects(createArchive(dataRoot, "srv-never-existed", "x"), /no data directory/);
});
