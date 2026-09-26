import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import {
  NotFoundError,
  PathError,
  directorySize,
  list,
  makeDirectory,
  move,
  openForRead,
  read,
  remove,
  resolveWithin,
  rootFor,
  write,
  writeFromStream,
} from "../src/files.ts";

/* Containment is the whole point of files.ts, so most of this file is
   trying to get out of the server directory. */

let base: string;
let root: string;
let outside: string;

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), "geeboard-files-"));
  root = path.join(base, "servers", "aurora");
  outside = path.join(base, "secrets");

  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, "plugins", "LuckPerms"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(path.join(root, "server.properties"), "level-name=aurora\nmax-players=40\n");
  await writeFile(path.join(root, "eula.txt"), "eula=true\n");
  await writeFile(path.join(root, "plugins", "LuckPerms", "config.yml"), "storage: h2\n");
  await writeFile(path.join(outside, "panel.env"), "SESSION_SECRET=super-secret\n");
});

after(async () => {
  await import("node:fs/promises").then((fs) => fs.rm(base, { recursive: true, force: true }));
});

const escapes = async (p: string) => {
  await assert.rejects(() => resolveWithin(root, p), PathError, `"${p}" should be refused`);
};

test("plain relative paths resolve inside the root", async () => {
  assert.equal(await resolveWithin(root, "server.properties"), path.join(root, "server.properties"));
  assert.equal(await resolveWithin(root, "plugins"), path.join(root, "plugins"));
  assert.equal(await resolveWithin(root, ""), root);
  assert.equal(await resolveWithin(root, "/"), root);
});

test("a leading slash is treated as root-relative, not absolute", async () => {
  // The panel sends "/plugins"; that must mean the server's plugins dir.
  assert.equal(await resolveWithin(root, "/plugins"), path.join(root, "plugins"));
  assert.equal(
    await resolveWithin(root, "/plugins/LuckPerms/config.yml"),
    path.join(root, "plugins", "LuckPerms", "config.yml"),
  );
});

test("dot-dot traversal is refused", async () => {
  await escapes("..");
  await escapes("../");
  await escapes("../secrets/panel.env");
  await escapes("../../etc/passwd");
  await escapes("plugins/../../secrets/panel.env");
  await escapes("./../../secrets");
  await escapes("plugins/../../../../../../etc/passwd");
});

test("traversal hidden behind a valid prefix is refused", async () => {
  await escapes("plugins/LuckPerms/../../../secrets/panel.env");
});

test("backslash separators are refused too", async () => {
  // Windows accepts these as separators; a Linux-only check would miss them.
  await escapes("..\\secrets\\panel.env");
  await escapes("plugins\\..\\..\\secrets");
});

test("a null byte is refused", async () => {
  await escapes("server.properties\0.txt");
});

test("a symlink pointing outside the root is refused", async () => {
  const link = path.join(root, "escape-hatch");
  try {
    await symlink(outside, link, "junction");
  } catch {
    return; // Symlink creation needs privileges on some systems.
  }

  await assert.rejects(() => resolveWithin(root, "escape-hatch"), PathError);
  await assert.rejects(() => resolveWithin(root, "escape-hatch/panel.env"), PathError);
  await assert.rejects(() => read(root, "escape-hatch/panel.env"), PathError);
});

test("rootFor refuses a server id that is itself a path", () => {
  assert.throws(() => rootFor("/data", "../../etc"), PathError);
  assert.throws(() => rootFor("/data", "aurora/../.."), PathError);
  assert.throws(() => rootFor("/data", ""), PathError);
  assert.equal(rootFor("/data", "aurora"), path.resolve("/data", "aurora"));
});

test("listing returns directories first, then names", async () => {
  const entries = await list(root, "/");
  const names = entries.map((e) => e.name);
  assert.ok(names.indexOf("plugins") < names.indexOf("server.properties"), names.join(","));
  const props = entries.find((e) => e.name === "server.properties")!;
  assert.equal(props.kind, "file");
  assert.ok(props.sizeBytes > 0);
  assert.match(props.mode, /^[rwx-]{9}$/);
});

test("listing a path that is not there is a not-found, not a crash", async () => {
  await assert.rejects(() => list(root, "nope"), NotFoundError);
});

test("listing a file rather than a directory is refused", async () => {
  await assert.rejects(() => list(root, "eula.txt"), PathError);
});

test("reading returns the file's contents", async () => {
  const result = await read(root, "server.properties");
  assert.match(result.content, /level-name=aurora/);
  assert.equal(result.truncated, false);
});

test("reading refuses a directory and reports a missing file", async () => {
  await assert.rejects(() => read(root, "plugins"), PathError);
  await assert.rejects(() => read(root, "absent.txt"), NotFoundError);
});

test("a file too large to edit is reported, not streamed", async () => {
  const big = path.join(root, "world.dat");
  await writeFile(big, "x".repeat(4096));
  const result = await read(root, "world.dat", 1024);
  assert.equal(result.truncated, true);
  assert.equal(result.content, "");
  assert.equal(result.sizeBytes, 4096);
});

test("writing creates a file and any parent directories", async () => {
  const entry = await write(root, "config/nested/new.yml", "hello: world\n");
  assert.equal(entry.kind, "file");
  assert.equal(entry.path, "config/nested/new.yml");
  assert.equal(await readFile(path.join(root, "config", "nested", "new.yml"), "utf8"), "hello: world\n");
});

test("writing outside the root is refused", async () => {
  await assert.rejects(() => write(root, "../secrets/panel.env", "owned"), PathError);
  assert.equal(
    await readFile(path.join(outside, "panel.env"), "utf8"),
    "SESSION_SECRET=super-secret\n",
    "the file outside the root is untouched",
  );
});

test("the server root cannot be deleted", async () => {
  await assert.rejects(() => remove(root, "/"), PathError);
  await assert.rejects(() => remove(root, ""), PathError);
});

test("deleting removes a file, and a missing one is reported", async () => {
  await write(root, "throwaway.txt", "bye");
  await remove(root, "throwaway.txt");
  await assert.rejects(() => read(root, "throwaway.txt"), NotFoundError);
  await assert.rejects(() => remove(root, "throwaway.txt"), NotFoundError);
});

test("deleting outside the root is refused", async () => {
  await assert.rejects(() => remove(root, "../secrets/panel.env"), PathError);
});

test("making a directory works, but not at the root itself", async () => {
  await makeDirectory(root, "logs/archive");
  const entries = await list(root, "logs");
  assert.equal(entries[0]?.name, "archive");
  await assert.rejects(() => makeDirectory(root, "/"), PathError);
});

test("moving stays inside the root", async () => {
  await write(root, "old-name.txt", "same content");
  await move(root, "old-name.txt", "renamed/new-name.txt");
  assert.equal((await read(root, "renamed/new-name.txt")).content, "same content");
  await assert.rejects(() => move(root, "renamed/new-name.txt", "../secrets/stolen.txt"), PathError);
  await assert.rejects(() => move(root, "does-not-exist", "anywhere.txt"), NotFoundError);
});

/* A world's size, which the panel showed as 0 B on every server because
   nothing measured it. */
test("a directory's size counts every file under it and nothing outside", async () => {
  const measured = path.join(base, "servers", "measured");
  await mkdir(path.join(measured, "world", "region"), { recursive: true });
  await writeFile(path.join(measured, "level.dat"), Buffer.alloc(1000));
  await writeFile(path.join(measured, "world", "region", "r.0.0.mca"), Buffer.alloc(4096));

  let linked = true;
  try {
    // A link out of the directory must not count what it points at.
    await symlink(path.join(outside, "panel.env"), path.join(measured, "escape.env"));
  } catch {
    linked = false; // Windows without developer mode
  }

  const size = await directorySize(measured);
  assert.equal(size.bytes, 5096);
  assert.equal(size.files, 2, linked ? "the symlink is not a file of this server" : undefined);
});

/* Bytes, streamed both ways: what the API's file upload and download
   rest on. The containment is the same; what is new is the ceiling and
   the rename. */
test("bytes round-trip unchanged, including ones that are not text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "geeboard-raw-"));
  try {
    const bytes = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256));
    const entry = await writeFromStream(root, "plugins/thing.jar", Readable.from([bytes.subarray(0, 40_000), bytes.subarray(40_000)]));
    assert.equal(entry.sizeBytes, bytes.length);
    assert.equal(entry.path, "plugins/thing.jar");

    const file = await openForRead(root, "plugins/thing.jar");
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(chunk as Buffer);
    assert.ok(Buffer.concat(chunks).equals(bytes));
    assert.equal(file.sizeBytes, bytes.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an upload that fails half-way leaves the file that was there", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "geeboard-raw-"));
  try {
    await writeFromStream(root, "icon.png", Readable.from([Buffer.from("the good one")]));
    const broken = new Readable({
      read() {
        this.push(Buffer.from("half of a new"));
        this.destroy(new Error("connection dropped"));
      },
    });
    await assert.rejects(writeFromStream(root, "icon.png", broken));
    assert.equal(await readFile(path.join(root, "icon.png"), "utf8"), "the good one");
    assert.deepEqual((await readdir(root)).sort(), ["icon.png"], "and no temporary file beside it");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an upload that ends cleanly but short of what was promised is refused, and changes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "geeboard-raw-"));
  try {
    await writeFromStream(root, "world.wld", Readable.from([Buffer.from("the whole world")]));
    /* What the panel's framework did to every upload over 10 MB: the
       stream simply ended there, with no error for anything to notice. */
    await assert.rejects(writeFromStream(root, "world.wld", Readable.from([Buffer.from("the first half")]), 30), /ended at 14 of 30 bytes/);
    assert.equal(await readFile(path.join(root, "world.wld"), "utf8"), "the whole world");
    assert.deepEqual((await readdir(root)).sort(), ["world.wld"], "and no temporary file beside it");

    const whole = await writeFromStream(root, "world.wld", Readable.from([Buffer.from("a new whole world")]), 17);
    assert.equal(whole.sizeBytes, 17, "and the promised count is written");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("raw reads and writes are confined like everything else", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "geeboard-raw-"));
  try {
    await assert.rejects(writeFromStream(root, "../outside.bin", Readable.from([Buffer.from("x")])), PathError);
    await assert.rejects(openForRead(root, "../../etc/passwd"), PathError);
    await assert.rejects(writeFromStream(root, "/", Readable.from([Buffer.from("x")])), PathError);
    await assert.rejects(openForRead(root, "nothing-here.bin"), /no such file/);
    await mkdir(path.join(root, "world"));
    await assert.rejects(writeFromStream(root, "world", Readable.from([Buffer.from("x")])), /directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
