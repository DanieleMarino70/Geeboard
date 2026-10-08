import assert from "node:assert/strict";
import { test } from "node:test";
import { movePath, nameKey } from "../src/domain/files/move-path.ts";

/* A rename's paths are read the way the agent reads them, or the panel judges one thing safe and the node does another (the audit of 0.9.5). */

test("a backslash is a slash, as it is to the agent, and stray slashes are nothing", () => {
  assert.deepEqual(movePath("plugins\\b.jar"), { ok: true, path: "plugins/b.jar" });
  assert.deepEqual(movePath("/plugins//b.jar/"), { ok: true, path: "plugins/b.jar" });
  assert.deepEqual(movePath("world"), { ok: true, path: "world" });
});

test("a dot-segment is refused and not collapsed: it would be read two ways", () => {
  for (const raw of ["server.properties/.", "a/../b", "./a", "..", "a\\..\\b", "plugins/./x"]) {
    const read = movePath(raw);
    assert.equal(read.ok, false, raw);
  }
  assert.deepEqual(movePath("a..b/c.d"), { ok: true, path: "a..b/c.d" }, "dots inside a name are a name");
});

test("a control character is refused", () => {
  assert.equal(movePath("a\u0000b").ok, false);
  assert.equal(movePath("a\nb").ok, false);
});

test("a Windows node does not tell Server.Properties from server.properties, nor a name from the same name with a dot at its end", () => {
  assert.equal(nameKey("Server.Properties", true), nameKey("server.properties", true));
  assert.equal(nameKey("a.txt.", true), nameKey("a.txt", true));
  assert.equal(nameKey("a.txt  ", true), nameKey("a.txt", true));
  assert.notEqual(nameKey("Server.Properties", false), nameKey("server.properties", false), "a Linux node does");
});
