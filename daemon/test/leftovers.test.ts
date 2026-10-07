import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import { writeFromStream } from "../src/files.ts";
import { sweepLeftovers } from "../src/leftovers.ts";

/* What a killed process leaves, and what clears it. Nothing here needs a
   kill: the leavings are written by hand where the real ones would be. */

let dataRoot: string;
const HOUR = 3600_000;

async function exists(target: string) {
  return stat(target).then(() => true, () => false);
}
async function touch(target: string, body: string, ageMs = 0) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  const when = new Date(Date.now() - ageMs);
  await utimes(target, when, when);
  // The directories it sits in are as old as it is: writing it made them new.
  for (let dir = path.dirname(target); dir !== dataRoot && dir.startsWith(dataRoot); dir = path.dirname(dir)) await utimes(dir, when, when);
}

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-leftovers-"));
});
beforeEach(async () => {
  for (const name of await readdir(dataRoot)) await rm(path.join(dataRoot, name), { recursive: true, force: true });
});
after(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

test("at start nothing is in flight, so every partial, upload and staging directory goes", async () => {
  await touch(path.join(dataRoot, ".backups", "srv", "a.tar.gz.partial.0011aabb"), "half");
  await touch(path.join(dataRoot, ".backups", "srv", "kept.tar.gz"), "a whole archive");
  await touch(path.join(dataRoot, ".uploads", "srv", "00ff.upload"), "half an upload");
  await touch(path.join(dataRoot, "srv.restoring-ab12", "world", "level.dat"), "half a world");
  await touch(path.join(dataRoot, "srv", "level.dat"), "the world");

  const result = await sweepLeftovers(dataRoot, { startup: true });

  assert.equal(result.removed.length, 3);
  assert.equal(await exists(path.join(dataRoot, ".backups", "srv", "kept.tar.gz")), true, "a whole archive is never touched");
  assert.equal(await exists(path.join(dataRoot, "srv", "level.dat")), true);
  assert.equal(await exists(path.join(dataRoot, "srv.restoring-ab12")), false);
  assert.equal(await exists(path.join(dataRoot, ".uploads", "srv", "00ff.upload")), false);
});

test("afterwards only what has not been touched for hours goes: a slow restore or upload that is alive is left alone", async () => {
  await touch(path.join(dataRoot, ".backups", "srv", "live.tar.gz.partial.aa11"), "being written", 10 * 60_000);
  await touch(path.join(dataRoot, ".backups", "srv", "dead.tar.gz.partial.bb22"), "abandoned", 4 * HOUR);
  await touch(path.join(dataRoot, ".uploads", "srv", "live.upload"), "arriving", 30 * 60_000);
  await touch(path.join(dataRoot, ".uploads", "srv", "dead.upload"), "abandoned", 5 * HOUR);
  await touch(path.join(dataRoot, "srv.restoring-cc33", "x"), "unpacking", HOUR);
  await touch(path.join(dataRoot, "gone.restoring-dd44", "x"), "abandoned", 8 * HOUR);

  const result = await sweepLeftovers(dataRoot);

  assert.equal(await exists(path.join(dataRoot, ".backups", "srv", "live.tar.gz.partial.aa11")), true);
  assert.equal(await exists(path.join(dataRoot, ".backups", "srv", "dead.tar.gz.partial.bb22")), false);
  assert.equal(await exists(path.join(dataRoot, ".uploads", "srv", "live.upload")), true);
  assert.equal(await exists(path.join(dataRoot, ".uploads", "srv", "dead.upload")), false);
  assert.equal(await exists(path.join(dataRoot, "srv.restoring-cc33")), true);
  assert.equal(await exists(path.join(dataRoot, "gone.restoring-dd44")), false);
  assert.equal(result.removed.length, 3);
});

test("a world set aside for an exchange that never finished is put back", async () => {
  // The two renames of a restore, interrupted between them: the world is missing and its previous contents are under another name.
  await touch(path.join(dataRoot, "srv.replaced-ee55", "world", "level.dat"), "THE PREVIOUS WORLD");
  await touch(path.join(dataRoot, "srv.restoring-ee55", "world", "level.dat"), "half of the new one");

  const result = await sweepLeftovers(dataRoot, { startup: true });

  assert.deepEqual(result.recovered, ["srv"]);
  assert.equal(await readFile(path.join(dataRoot, "srv", "world", "level.dat"), "utf8"), "THE PREVIOUS WORLD");
  assert.equal(await exists(path.join(dataRoot, "srv.replaced-ee55")), false);
  assert.equal(await exists(path.join(dataRoot, "srv.restoring-ee55")), false);
});

test("a world set aside after an exchange that did finish is only disk, and goes — never the world that is in place", async () => {
  await touch(path.join(dataRoot, "srv", "level.dat"), "THE NEW WORLD");
  await touch(path.join(dataRoot, "srv.replaced-ff66", "level.dat"), "the old one");

  const result = await sweepLeftovers(dataRoot, { startup: true });

  assert.deepEqual(result.recovered, []);
  assert.equal(await readFile(path.join(dataRoot, "srv", "level.dat"), "utf8"), "THE NEW WORLD");
  assert.equal(await exists(path.join(dataRoot, "srv.replaced-ff66")), false);
});

test("a data root with nothing in it, or not yet made, is not an error", async () => {
  assert.deepEqual(await sweepLeftovers(dataRoot, { startup: true }), { removed: [], recovered: [] });
  assert.deepEqual(await sweepLeftovers(path.join(dataRoot, "not-there"), { startup: true }), { removed: [], recovered: [] });
});

/* ── Uploads write elsewhere ──────────────────────────────────────── */

test("an upload is written outside the server's directory and leaves nothing in it", async () => {
  const root = path.join(dataRoot, "srv-up");
  await mkdir(root, { recursive: true });
  let beside: string[] = ["not looked"];
  let under: string[] = [];
  const source = Readable.from(
    (async function* () {
      yield Buffer.from("first half ");
      // While the upload is open the target's directory holds nothing of it, and the temporary is under .uploads.
      beside = await readdir(path.join(root, "plugins"));
      under = await readdir(path.join(dataRoot, ".uploads", "srv-up"));
      yield Buffer.from("second half");
    })(),
  );

  const entry = await writeFromStream(root, "plugins/x.jar", source);

  assert.equal(entry.sizeBytes, "first half second half".length);
  assert.deepEqual(beside, [], "no .upload file beside the target while it is arriving");
  assert.equal(under.length, 1);
  assert.match(under[0]!, /^[0-9a-f]{16}\.upload$/, "under a name nobody can guess");
  assert.equal(await readFile(path.join(root, "plugins", "x.jar"), "utf8"), "first half second half");
  assert.deepEqual(await readdir(path.join(dataRoot, ".uploads", "srv-up")), [], "and the temporary is gone when it is done");
});
