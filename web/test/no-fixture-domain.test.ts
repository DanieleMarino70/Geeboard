import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* The sample workspace's domain is the sample workspace's. `workspaceDomain()` fell back on a literal "ashfold.gg" on an empty workspace, so
   the first server of every install without a DNS provider was offered `server.ashfold.gg`, a name nobody who runs the panel owns. It is
   in the seed, and in the demo account's address on the sign-in page of a development panel; it is not in anything a production panel runs. */

const SRC = path.join(import.meta.dirname, "..", "src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) files(file, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(file);
  }
  return out;
}

test("the sample workspace's domain is not written into anything the panel runs", () => {
  const found: string[] = [];
  for (const file of files(SRC)) {
    // What a comment says about it is history; what code says is behaviour. Block comments are blanked, keeping their lines.
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
    code.split(/\r?\n/).forEach((line, i) => {
      // The demo account's own address, shown on a development panel's sign-in page, is the seed's.
      const without = line.replace(/\/\/.*$/, "").replace(/[\w.+-]+@ashfold\.gg/g, "");
      if (/ashfold\.gg/.test(without)) found.push(`${path.relative(SRC, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});
