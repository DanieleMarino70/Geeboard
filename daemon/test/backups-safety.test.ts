import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { BackupError, backupRoot, createArchive, floorFor, listArchives, restoreArchive } from "../src/backups.ts";

/* What a backup and a restore do when things go wrong. The round trip is
   backups.test.ts; this is the other half, and the half that matters: a
   restore that fails must leave the world it was asked to replace exactly as
   it was, and a backup that fails must leave nothing that looks like one. */

const SERVER = "srv-safety";
let dataRoot: string;
let root: string;

const MIB = 1024 * 1024;
/* A disk with the room it is told it has. */
const room = (free: number, total = 100 * MIB) => async () => ({ free, total });

async function seedWorld() {
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "world"), { recursive: true });
  await writeFile(path.join(root, "server.properties"), "motd=the world as it was\n");
  await writeFile(path.join(root, "world", "level.dat"), "LEVEL-AS-IT-WAS");
  await writeFile(path.join(root, "added-since.txt"), "a file the archive does not have");
}

/** Every file under a directory, with its contents, to compare a world before and after. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
    }
  };
  await walk(dir);
  return out;
}

/** What is beside the world that should not be: staging and aside directories, partial archives. */
async function leftovers(): Promise<string[]> {
  const found: string[] = [];
  for (const name of await readdir(dataRoot)) if (/\.(restoring|replaced)-/.test(name)) found.push(name);
  const archives = backupRoot(dataRoot, SERVER);
  for (const name of await readdir(archives).catch(() => [])) if (name.includes(".partial.")) found.push(`.backups/${name}`);
  return found;
}

/* A tar by hand, for archives no honest backup would produce. */
function tarOf(entries: Array<{ name: string; body?: string; type?: string }>, withEnd = true): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? "");
    const head = Buffer.alloc(512);
    head.write(entry.name, 0, 100);
    head.write("0000644\0", 100, 8, "ascii");
    head.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    head.write(entry.type ?? "0", 156, 1, "ascii");
    head.write("ustar\0", 257, 6, "ascii");
    head.write("00", 263, 2, "ascii");
    head.write("        ", 148, 8, "ascii");
    let sum = 0;
    for (const byte of head) sum += byte;
    head.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(head, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  if (withEnd) blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function putArchive(name: string, bytes: Buffer): Promise<string> {
  const dir = backupRoot(dataRoot, SERVER);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return name;
}

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-safety-"));
  root = path.join(dataRoot, SERVER);
  // The real floor is 2 GB or 5 percent of the disk; these worlds are kilobytes on a pretend disk of megabytes.
  process.env.GEEBOARD_BACKUP_FLOOR_BYTES = String(1 * MIB);
});

beforeEach(async () => {
  await rm(path.join(dataRoot, ".backups"), { recursive: true, force: true });
  for (const name of await readdir(dataRoot)) if (name !== SERVER) await rm(path.join(dataRoot, name), { recursive: true, force: true });
  await seedWorld();
});

after(async () => {
  delete process.env.GEEBOARD_BACKUP_FLOOR_BYTES;
  await rm(dataRoot, { recursive: true, force: true });
});

/* ── A restore that fails changes nothing ─────────────────────────── */

async function assertUntouched(attempt: () => Promise<unknown>, says: RegExp) {
  const before = await snapshot(root);
  await assert.rejects(attempt, (error: unknown) => {
    assert.ok(error instanceof BackupError, `a BackupError, not ${String(error)}`);
    assert.equal(error.code, "restore-untouched");
    assert.match(error.message, says);
    assert.match(error.message, /Nothing was changed/);
    return true;
  });
  assert.deepEqual(await snapshot(root), before, "the world is exactly as it was");
  assert.deepEqual(await leftovers(), [], "and nothing is left beside it");
}

test("a restore of an archive that is not there changes nothing", async () => {
  await assertUntouched(() => restoreArchive(dataRoot, SERVER, "nothing.tar.gz"), /no such archive/);
});

test("a restore of a truncated archive changes nothing", async () => {
  const good = await createArchive(dataRoot, SERVER, "whole");
  const bytes = await readFile(path.join(backupRoot(dataRoot, SERVER), good.artifact));
  const cut = await putArchive("cut.tar.gz", bytes.subarray(0, Math.floor(bytes.length / 2)));
  await assertUntouched(() => restoreArchive(dataRoot, SERVER, cut), /cut short|unexpected end/i);
});

test("an archive that ends at an entry boundary without its end marker is not a whole archive", async () => {
  const cut = await putArchive("no-end.tar.gz", gzipSync(tarOf([{ name: "world/level.dat", body: "FROM THE ARCHIVE" }], false)));
  await assertUntouched(() => restoreArchive(dataRoot, SERVER, cut), /end marker/);
});

test("a write that fails half-way through is an error the panel hears, and the world stays", async () => {
  // `x` is a file, then something is asked to live inside it: the second entry cannot be written.
  const bad = await putArchive("conflict.tar.gz", gzipSync(tarOf([{ name: "x", body: "a file" }, { name: "x/y.txt", body: "inside a file" }])));
  await assertUntouched(() => restoreArchive(dataRoot, SERVER, bad), /./);
});

test("an entry that leaves the server's directory is refused before anything is exchanged", async () => {
  const bad = await putArchive("escape.tar.gz", gzipSync(tarOf([{ name: "fine.txt", body: "ok" }, { name: "../../outside.txt", body: "no" }])));
  await assertUntouched(() => restoreArchive(dataRoot, SERVER, bad), /escapes the server directory/);
  await assert.rejects(stat(path.join(dataRoot, "..", "outside.txt")), /ENOENT/);
});

test("a restore that works replaces the world whole and leaves nothing beside it", async () => {
  const made = await createArchive(dataRoot, SERVER, "good");
  await writeFile(path.join(root, "world", "level.dat"), "CHANGED SINCE");
  const result = await restoreArchive(dataRoot, SERVER, made.artifact, made.checksum);
  assert.equal(result.mode, "swapped");
  assert.equal(await readFile(path.join(root, "world", "level.dat"), "utf8"), "LEVEL-AS-IT-WAS");
  // "added-since.txt" was in the world when it was archived, so it is back; what was written after is gone.
  assert.equal(await readFile(path.join(root, "added-since.txt"), "utf8"), "a file the archive does not have");
  assert.deepEqual(await leftovers(), []);
});

test("a restore on a node with no room for two copies says what it needs and what it has, and changes nothing", async () => {
  const made = await createArchive(dataRoot, SERVER, "roomy");
  await assertUntouched(
    () => restoreArchive(dataRoot, SERVER, made.artifact, made.checksum, {}, { space: room(1 * MIB) }),
    /restoring needs about .* the node has 1 MB free/,
  );
});

test("restoring in place is a choice, replaces the world first, and works when the archive is whole", async () => {
  const made = await createArchive(dataRoot, SERVER, "inplace");
  await writeFile(path.join(root, "world", "level.dat"), "CHANGED SINCE");
  const result = await restoreArchive(dataRoot, SERVER, made.artifact, made.checksum, { inPlace: true }, { space: room(10 * MIB) });
  assert.equal(result.mode, "in-place");
  assert.equal(await readFile(path.join(root, "world", "level.dat"), "utf8"), "LEVEL-AS-IT-WAS");
});

test("in place, a restore that fails says the world is incomplete, because it is", async () => {
  const bad = await putArchive("bad-inplace.tar.gz", gzipSync(tarOf([{ name: "x", body: "a file" }, { name: "x/y.txt", body: "inside a file" }])));
  await assert.rejects(
    () => restoreArchive(dataRoot, SERVER, bad, undefined, { inPlace: true }, { space: room(10 * MIB) }),
    (error: unknown) => {
      assert.ok(error instanceof BackupError);
      assert.equal(error.code, "restore-incomplete");
      assert.match(error.message, /incomplete/);
      return true;
    },
  );
});

test("a restore stops before it fills the disk it is writing to, and the world stays", async () => {
  await writeFile(path.join(root, "big.bin"), Buffer.alloc(2 * MIB, 7));
  const made = await createArchive(dataRoot, SERVER, "filling", { space: room(50 * MIB) });
  // Room at the start, none by the time a few kilobytes have been written: what an estimate that was too low looks like.
  let looks = 0;
  const shrinking = async () => ({ free: ++looks <= 3 ? 50 * MIB : 100 * 1024, total: 100 * MIB });
  await assertUntouched(
    () => restoreArchive(dataRoot, SERVER, made.artifact, made.checksum, {}, { space: shrinking, checkEveryBytes: 64 * 1024 }),
    /about to fill/,
  );
});

test("what is kept free is the larger of 2 GB and 5 percent of the disk, unless somebody says otherwise", () => {
  const GIB = 1024 * MIB;
  assert.equal(floorFor(10 * GIB, {}), 2 * GIB);
  assert.equal(floorFor(100 * GIB, {}), 5 * GIB);
  assert.equal(floorFor(100 * GIB, { GEEBOARD_BACKUP_FLOOR_BYTES: String(3 * MIB) }), 3 * MIB);
  assert.equal(floorFor(10 * GIB, { GEEBOARD_BACKUP_FLOOR_BYTES: "not a number" }), 2 * GIB, "a typo is not a floor of zero");
});

/* ── A backup that fails leaves nothing that looks like one ───────── */

test("a backup the disk cannot hold is refused with the numbers, and writes nothing", async () => {
  await writeFile(path.join(root, "big.bin"), Buffer.alloc(4 * MIB));
  await assert.rejects(
    () => createArchive(dataRoot, SERVER, "toobig", { space: room(3 * MIB) }),
    (error: unknown) => {
      assert.ok(error instanceof BackupError);
      assert.match(error.message, /this backup needs about .*the world is 4 MB.* The node has 3 MB free/);
      return true;
    },
  );
  assert.deepEqual(await listArchives(dataRoot, SERVER), []);
  assert.deepEqual(await leftovers(), []);
});

test("a backup that fails part-way leaves no partial archive, and nothing that lists as one", async () => {
  await assert.rejects(
    () =>
      createArchive(dataRoot, SERVER, "doomed", {
        space: room(50 * MIB),
        afterOpen: async (file) => {
          if (file.endsWith("level.dat")) throw new Error("the disk went away");
        },
      }),
    /the disk went away/,
  );
  assert.deepEqual(await listArchives(dataRoot, SERVER), []);
  assert.deepEqual(await leftovers(), []);
});

test("a partial archive from a killed process is never listed as an archive", async () => {
  await putArchive("nightly.tar.gz.partial.0a1b2c3d4e5f", Buffer.from("half a world"));
  assert.deepEqual(await listArchives(dataRoot, SERVER), []);
});

test("a name that is taken is refused rather than written over", async () => {
  const first = await createArchive(dataRoot, SERVER, "same", { space: room(50 * MIB) });
  const before = await readFile(path.join(backupRoot(dataRoot, SERVER), first.artifact));
  await writeFile(path.join(root, "more.txt"), "more");
  await assert.rejects(() => createArchive(dataRoot, SERVER, "same", { space: room(50 * MIB) }), /already exists/);
  assert.deepEqual(await readFile(path.join(backupRoot(dataRoot, SERVER), first.artifact)), before);
  assert.deepEqual(await leftovers(), []);
});

/* ── A live world ─────────────────────────────────────────────────── */

test("a world that changes while it is archived still archives: padded, truncated or skipped, and said", async () => {
  await writeFile(path.join(root, "latest.log"), "L".repeat(20_000));
  await writeFile(path.join(root, "shrinks.dat"), "S".repeat(20_000));
  await writeFile(path.join(root, "vanishes.dat"), "V".repeat(1000));

  const made = await createArchive(dataRoot, SERVER, "live", {
    space: room(50 * MIB),
    afterOpen: async (file) => {
      if (file.endsWith("latest.log")) await appendFile(file, "MORE THAN WAS THERE");
      if (file.endsWith("shrinks.dat")) await truncate(file, 100);
    },
  });
  // vanishes.dat is removed after the walk listed it and before it is opened: do it through the hook of an earlier file.
  assert.ok(made.warnings.some((w) => /latest\.log grew/.test(w)), made.warnings.join("; "));
  assert.ok(made.warnings.some((w) => /shrinks\.dat shrank/.test(w)), made.warnings.join("; "));

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await restoreArchive(dataRoot, SERVER, made.artifact, made.checksum, {}, { space: room(50 * MIB) });

  assert.equal((await readFile(path.join(root, "latest.log"), "utf8")).length, 20_000, "a log that grew has the bytes it had when it was opened");
  const shrunk = await readFile(path.join(root, "shrinks.dat"));
  assert.equal(shrunk.length, 20_000, "a file that shrank keeps the size its header promised");
  assert.equal(shrunk.subarray(0, 100).toString(), "S".repeat(100));
  assert.ok(shrunk.subarray(100).every((b) => b === 0), "padded with zeros");
});

test("a file that is gone by the time it is opened is skipped, and the backup goes on", async () => {
  await writeFile(path.join(root, "a-first.txt"), "first");
  await writeFile(path.join(root, "z-doomed.txt"), "doomed");
  const made = await createArchive(dataRoot, SERVER, "vanish", {
    space: room(50 * MIB),
    // The walk has listed everything; the first file's hook removes the last before it is reached.
    afterOpen: async (file) => {
      if (file.endsWith("a-first.txt")) await rm(path.join(root, "z-doomed.txt"));
    },
  });
  assert.ok(made.warnings.some((w) => /z-doomed\.txt was skipped/.test(w)), made.warnings.join("; "));
  assert.equal(gunzipSync(await readFile(path.join(backupRoot(dataRoot, SERVER), made.artifact))).includes("doomed"), false);
});
