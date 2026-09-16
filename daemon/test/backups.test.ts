import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";
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

/* A Minecraft server's libraries directory holds paths of nearly 150
   bytes, and the archive format used to stop at 100 — so every Minecraft
   backup failed, found by running one for real. */
const LONG_DIR = ["libraries", "com", "google", "guava", "listenablefuture", "9999.0-empty-to-avoid-conflict-with-guava"];
const LONG_FILE = "listenablefuture-9999.0-empty-to-avoid-conflict-with-guava.jar";
const VERY_LONG = "d".repeat(90);

test("a path longer than the header field round-trips", async () => {
  const root = await seedWorld();
  await mkdir(path.join(root, ...LONG_DIR), { recursive: true });
  await writeFile(path.join(root, ...LONG_DIR, LONG_FILE), "jar bytes");
  // Past USTAR's own 255-byte ceiling too, and a directory that is long itself.
  const deep = path.join(root, VERY_LONG, VERY_LONG, VERY_LONG);
  await mkdir(deep, { recursive: true });
  await writeFile(path.join(deep, "é-level.dat"), "deep");

  const result = await createArchive(dataRoot, SERVER, "long-paths");
  await rm(root, { recursive: true, force: true });
  await restoreArchive(dataRoot, SERVER, result.artifact, result.checksum);

  assert.equal(await readFile(path.join(root, ...LONG_DIR, LONG_FILE), "utf8"), "jar bytes");
  assert.equal(await readFile(path.join(deep, "é-level.dat"), "utf8"), "deep");
  // Nothing was written under the placeholder name the metadata entry carries.
  await assert.rejects(readFile(path.join(root, "././@PaxHeader")));
  assert.equal(await readFile(path.join(root, "server.properties"), "utf8"), "max-players=20\nmotd=hello\n");
});

/* An archive nobody but Geeboard can open is a backup held hostage. The
   long paths go in PAX headers, which every tar in use reads. Skipped
   where there is no tar to ask. */
test("another tar reads the long paths back", async (t) => {
  const root = await seedWorld();
  await mkdir(path.join(root, ...LONG_DIR), { recursive: true });
  await writeFile(path.join(root, ...LONG_DIR, LONG_FILE), "jar bytes");
  const result = await createArchive(dataRoot, SERVER, "interop");

  // By name from its own directory: GNU tar reads "C:\…" as a remote host.
  const listing = spawnSync("tar", ["-tzf", result.artifact], {
    cwd: backupRoot(dataRoot, SERVER),
    encoding: "utf8",
  });
  if (listing.error) {
    t.skip("no tar on this machine");
    return;
  }
  assert.equal(listing.status, 0, listing.stderr);
  assert.ok(listing.stdout.split(/\r?\n/).includes([...LONG_DIR, LONG_FILE].join("/")), listing.stdout);
  assert.equal(listing.stdout.includes("PaxHeader"), false, "the metadata entry is not a file");
});

/* Restores also take archives other tools wrote: GNU tar's long-name
   entries, and USTAR's prefix field. Built by hand so the test does not
   depend on which tar a machine has. */
function tarBlock(name: string, size: number, type: string, prefix = ""): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, 100, "utf8");
  block.write("0000644\0", 100, 8, "ascii");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  block.write("00000000000\0", 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write(type, 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
}

function padded(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  return Buffer.concat([bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}

test("a restore reads GNU long names and USTAR prefixes", async () => {
  const gnuName = [...LONG_DIR, LONG_FILE].join("/");
  const archive = Buffer.concat([
    tarBlock("././@LongLink", Buffer.byteLength(gnuName) + 1, "L"),
    padded(`${gnuName}\0`),
    tarBlock(gnuName.slice(0, 100), 3, "0"),
    padded("gnu"),
    tarBlock("level.dat", 5, "0", "world/region/prefixed"),
    padded("ustar"),
    Buffer.alloc(1024),
  ]);
  const artifact = "foreign.tar.gz";
  await mkdir(backupRoot(dataRoot, SERVER), { recursive: true });
  await writeFile(path.join(backupRoot(dataRoot, SERVER), artifact), gzipSync(archive));

  const root = path.join(dataRoot, SERVER);
  const restored = await restoreArchive(dataRoot, SERVER, artifact);
  assert.equal(restored.files, 2);
  assert.equal(await readFile(path.join(root, ...LONG_DIR, LONG_FILE), "utf8"), "gnu");
  assert.equal(await readFile(path.join(root, "world", "region", "prefixed", "level.dat"), "utf8"), "ustar");
});

test("a long name cannot be used to escape the server's directory", async () => {
  const escape = `${"../".repeat(40)}escaped.txt`;
  const archive = Buffer.concat([
    tarBlock("././@LongLink", Buffer.byteLength(escape) + 1, "L"),
    padded(`${escape}\0`),
    tarBlock("harmless.txt", 1, "0"),
    padded("x"),
    Buffer.alloc(1024),
  ]);
  await mkdir(backupRoot(dataRoot, SERVER), { recursive: true });
  await writeFile(path.join(backupRoot(dataRoot, SERVER), "escape.tar.gz"), gzipSync(archive));
  await assert.rejects(restoreArchive(dataRoot, SERVER, "escape.tar.gz"), /escapes the server directory/);
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
