import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { Worker } from "node:worker_threads";

/* What a game's own process can do to its folder while the agent works in it: make links, and swap a directory for one.

   files.ts walks a path through the directories it has opened, never following a link it has not read (beneath.ts), so
   nothing inside the folder changes what a name means between the check and the use. These tests are the ones that would
   have failed before: a link to somewhere outside on the way to a file, and a race that turns a directory into such a link
   while an upload is in flight. They need /proc/self/fd, which is Linux; the Windows agent keeps the old check and is
   tested by files.test.ts. FILES_MODULE names another copy of files.ts, which is how the old one is shown to lose. */

const linux = process.platform === "linux";
const files = (await import(process.env.FILES_MODULE ?? "../src/files.ts")) as typeof import("../src/files.ts");
const { PathError, NotFoundError } = files;

let base: string;
let root: string;
let outside: string;

const exists = (p: string) => lstat(p).then(() => true, () => false);

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), "geeboard-beneath-"));
  root = path.join(base, "servers", "aurora");
  outside = path.join(base, "canary");
  await mkdir(path.join(root, "world", "region"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "server.properties"), "level-name=aurora\n");
  await writeFile(path.join(root, "world", "level.dat"), "LEVEL");
  await writeFile(path.join(outside, "secret.txt"), "SECRET");
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const bytes = (n: number) => Readable.from([Buffer.alloc(n, 97)]);

describe("links that stay inside the folder work as they always did", { skip: !linux }, () => {
  test("a link to a file, to a directory, with ../ and absolute, inside", async () => {
    await symlink("server.properties", path.join(root, "props-link"));
    await symlink("world", path.join(root, "world-link"));
    await symlink("../server.properties", path.join(root, "world", "up-link"));
    await symlink(path.join(await realpathOf(root), "world", "level.dat"), path.join(root, "abs-link"));

    assert.equal((await files.read(root, "props-link")).content, "level-name=aurora\n");
    assert.equal((await files.read(root, "world-link/level.dat")).content, "LEVEL");
    assert.equal((await files.read(root, "world/up-link")).content, "level-name=aurora\n");
    assert.equal((await files.read(root, "abs-link")).content, "LEVEL");
    assert.ok((await files.list(root, "world-link")).some((e) => e.name === "level.dat"));

    await files.write(root, "world-link/written.txt", "through a link");
    assert.equal(await readFile(path.join(root, "world", "written.txt"), "utf8"), "through a link");
  });

  test("a link in a listing is described as what it points at, when that is inside", async () => {
    const rows = await files.list(root, "");
    const link = rows.find((e) => e.name === "world-link")!;
    assert.equal(link.kind, "directory");
    assert.equal(rows.find((e) => e.name === "props-link")!.kind, "file");
  });

  test("removing a link removes the link, and moving one moves the link", async () => {
    await symlink("world", path.join(root, "gone-link"));
    await files.remove(root, "gone-link");
    assert.equal(await exists(path.join(root, "gone-link")), false);
    assert.equal(await exists(path.join(root, "world", "level.dat")), true, "what it pointed at is still there");

    await symlink("world", path.join(root, "moving-link"));
    await files.move(root, "moving-link", "moved-link");
    assert.equal(await readlink(path.join(root, "moved-link")), "world");
    assert.equal(await exists(path.join(root, "moving-link")), false);
  });
});

async function realpathOf(p: string) {
  return (await import("node:fs/promises")).realpath(p);
}

describe("a link that leaves the folder is refused, on the way and at the end", { skip: !linux }, () => {
  before(async () => {
    await symlink(outside, path.join(root, "evil-dir"));
    await symlink(path.join(outside, "secret.txt"), path.join(root, "evil-file"));
    await symlink("../../canary", path.join(root, "world", "evil-up"));
    await symlink("../../../canary/secret.txt", path.join(root, "world", "region", "evil-deep"));
  });

  test("reading and listing", async () => {
    await assert.rejects(() => files.read(root, "evil-file"), PathError);
    await assert.rejects(() => files.read(root, "evil-dir/secret.txt"), PathError);
    await assert.rejects(() => files.read(root, "world/evil-up/secret.txt"), PathError);
    await assert.rejects(() => files.read(root, "world/region/evil-deep"), PathError);
    await assert.rejects(() => files.list(root, "evil-dir"), PathError);
    await assert.rejects(() => files.openForRead(root, "evil-dir/secret.txt"), PathError);
  });

  test("a listing does not describe what a link points at outside", async () => {
    const rows = await files.list(root, "");
    const dir = rows.find((e) => e.name === "evil-dir")!;
    const file = rows.find((e) => e.name === "evil-file")!;
    assert.equal(dir.kind, "other");
    assert.equal(file.kind, "other");
    assert.equal(file.sizeBytes, 0, "the size of a file outside is not ours to say");
  });

  test("writing, making a directory, uploading, moving and removing never reach outside", async () => {
    await assert.rejects(() => files.write(root, "evil-dir/new.txt", "x"), PathError);
    await assert.rejects(() => files.write(root, "evil-file", "overwritten"), PathError);
    await assert.rejects(() => files.makeDirectory(root, "evil-dir/made"), PathError);
    await assert.rejects(() => files.writeFromStream(root, "evil-dir/up.bin", bytes(64), 64), PathError);
    await assert.rejects(() => files.writeFromStream(root, "world/evil-up/up.bin", bytes(64), 64), PathError);
    await assert.rejects(() => files.move(root, "server.properties", "evil-dir/taken.txt"), PathError);
    await assert.rejects(() => files.remove(root, "evil-dir/secret.txt"), PathError);
    assert.deepEqual((await readdir(outside)).sort(), ["secret.txt"], "nothing was made or removed outside");
    assert.equal(await readFile(path.join(outside, "secret.txt"), "utf8"), "SECRET");
    assert.equal(await exists(path.join(root, "server.properties")), true, "and the file that was to be moved is where it was");
  });

  test("a loop of links is an error, not a hang", async () => {
    await symlink("loop-b", path.join(root, "loop-a"));
    await symlink("loop-a", path.join(root, "loop-b"));
    await assert.rejects(() => files.read(root, "loop-a"), PathError);
  });

  test("a link to nothing is not found", async () => {
    await symlink("not-there", path.join(root, "dangling"));
    await assert.rejects(() => files.read(root, "dangling"), NotFoundError);
  });
});

describe("an upload does not leave a name beside the file for a game to plant a link at", { skip: !linux }, () => {
  test("a link at the old predictable name changes nothing, and no such name is made", async () => {
    // The name it used to be written under: <file>.<pid>.<ms>.upload, beside the target. A link there used to redirect the write.
    const guess = path.join(root, `planted.bin.${process.pid}.${Date.now()}.upload`);
    await symlink(path.join(outside, "planted-target"), guess);
    await files.writeFromStream(root, "planted.bin", bytes(32), 32);
    assert.equal(await exists(path.join(outside, "planted-target")), false);
    assert.deepEqual((await readdir(root)).filter((n) => n.endsWith(".upload") && n !== path.basename(guess)), []);
    assert.equal((await readFile(path.join(root, "planted.bin"))).length, 32);
  });

  test("an upload replaces a link at the target's own name, as a rename always did", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "replaced-link"));
    await files.writeFromStream(root, "replaced-link", bytes(16), 16);
    assert.equal((await lstat(path.join(root, "replaced-link"))).isSymbolicLink(), false, "now a file");
    assert.equal(await readFile(path.join(outside, "secret.txt"), "utf8"), "SECRET", "and what it pointed at was not written");
  });
});

describe("a directory swapped for a link while uploads are in flight", { skip: !linux }, () => {
  test("nothing is ever written outside the folder", { timeout: 120_000 }, async () => {
    const stage = path.join(root, "swap");
    const aside = path.join(root, "swap.aside");
    const canary = path.join(base, "swap-canary");
    await mkdir(stage, { recursive: true });
    await mkdir(canary, { recursive: true });

    // The loop a hostile process would run: rename the directory aside, put a link to somewhere else where it was, and put it back.
    // [0] says stop, [1] counts the swaps the loop has made so far.
    const shared = new Int32Array(new SharedArrayBuffer(8));
    const worker = new Worker(
      `
      const { workerData } = require("node:worker_threads");
      const fs = require("node:fs");
      const shared = new Int32Array(workerData.shared);
      let swaps = 0;
      // Where a step failed because the other side was in the way: put the directory back, whatever was made in its place.
      // (An upload that finds the directory missing makes a new one, and then the swap cannot go on until that is out of the way.)
      const settle = () => {
        try {
          const now = fs.lstatSync(workerData.stage);
          if (now.isSymbolicLink()) fs.unlinkSync(workerData.stage);
          else if (fs.existsSync(workerData.aside)) fs.rmSync(workerData.stage, { recursive: true, force: true });
        } catch {}
        try { if (!fs.existsSync(workerData.stage) && fs.existsSync(workerData.aside)) fs.renameSync(workerData.aside, workerData.stage); } catch {}
      };
      while (Atomics.load(shared, 0) === 0) {
        try {
          fs.renameSync(workerData.stage, workerData.aside);
          fs.symlinkSync(workerData.canary, workerData.stage);
          fs.unlinkSync(workerData.stage);
          fs.renameSync(workerData.aside, workerData.stage);
          swaps++;
          Atomics.store(shared, 1, swaps);
        } catch { settle(); }
      }
      settle();
      require("node:worker_threads").parentPort.postMessage(swaps);
      `,
      { eval: true, workerData: { shared: shared.buffer, stage, aside, canary } },
    );
    const swapped = new Promise<number>((resolve) => worker.once("message", resolve));

    let landed = 0;
    let refused = 0;
    // Until the loop has swapped the directory a few hundred times, or a minute has gone: a fast machine finishes four hundred
    // uploads in a second, and a test that did not race anything proves nothing.
    const started = Date.now();
    for (let i = 0; (i < 400 || Atomics.load(shared, 1) < 300) && Date.now() - started < 60_000; i++) {
      try {
        await files.writeFromStream(root, `swap/up-${i % 8}.bin`, bytes(2048), 2048);
        landed++;
      } catch {
        refused++;
      }
      try {
        await files.write(root, `swap/note-${i % 4}.txt`, "text");
      } catch {
        /* refused, or the directory was away: either is fine */
      }
    }
    Atomics.store(shared, 0, 1);
    const swaps = await swapped;
    await worker.terminate();

    const escaped = await readdir(canary);
    console.log(`       ${swaps} swaps, ${landed} uploads landed, ${refused} refused, ${escaped.length} files outside`);
    assert.ok(swaps >= 100, `the loop has to have run to mean anything: ${swaps} swaps`);
    assert.deepEqual(escaped, [], "something was written through the link");
  });
});
