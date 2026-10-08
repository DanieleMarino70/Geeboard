import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { keepDataRootPrivate } from "../src/privacy.ts";

/* On a Linux machine with another account, the folders the agent keeps were readable by it. The data root is passed through and not listed,
   and the two folders only the agent uses are the agent's alone (the audit of 0.9.5). Modes mean nothing on Windows, where an ACL does the work. */

const onLinux = process.platform === "linux";

test("the data root is traversable and not listable, and the agent's own folders are closed to everyone else", { skip: !onLinux && "modes are a Linux matter" }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "geeboard-privacy-"));
  try {
    mkdirSync(path.join(root, ".backups"), { mode: 0o755 }); // an older install left it open
    const said: string[] = [];
    const say = (message: string) => void said.push(message);
    await keepDataRootPrivate(root, say);
    const mode = (p: string) => statSync(p).mode & 0o777;
    assert.equal(mode(root), 0o711);
    assert.equal(mode(path.join(root, ".backups")), 0o700, "an existing folder is closed, not only a new one");
    assert.equal(mode(path.join(root, ".uploads")), 0o700);
    assert.deepEqual(said, []);
    // Again: nothing changes, nothing is said.
    await keepDataRootPrivate(root, say);
    assert.equal(mode(root), 0o711);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a folder it cannot change is said, and the agent goes on", { skip: !onLinux && "modes are a Linux matter" }, async () => {
  const said: string[] = [];
  // A path under a file: mkdir cannot make it, for anybody (root included).
  const dir = mkdtempSync(path.join(tmpdir(), "geeboard-privacy-"));
  const file = path.join(dir, "a-file");
  writeFileSync(file, "x");
  try {
    await keepDataRootPrivate(path.join(file, "root"), (message) => void said.push(message));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(said.length, 1);
  assert.match(said[0]!, /could not be made private/);
});
