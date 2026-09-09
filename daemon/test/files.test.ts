import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  NotFoundError,
  PathError,
  list,
  makeDirectory,
  move,
  read,
  remove,
  resolveWithin,
  rootFor,
  write,
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
