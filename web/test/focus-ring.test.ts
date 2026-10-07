import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* A field that has no focus ring is one a keyboard user cannot find. `outline-none` removed the global ring (utilities win over the base
   layer), and what replaced it was a one-pixel border at thirty percent accent, 1.07:1 against the one it replaced in the light theme.
   Twenty-one places did it. A field says it has a ring (`focus-visible:outline` or `focus-within:outline` on the same class string), or it uses
   `outline-hidden`, which leaves a transparent outline that forced-colours mode draws, and puts the ring on the wrapper that has focus. */

const SRC = path.join(import.meta.dirname, "..", "src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) files(file, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(file);
  }
  return out;
}

test("no field loses its outline without a ring in its place", () => {
  const bare: string[] = [];
  for (const file of files(SRC)) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/(^|[\s"'`])outline-none(?=[\s"'`]|$)/.test(line) && !/(focus-visible|focus-within|focus):outline-(\d|\[)/.test(line)) {
          bare.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(bare, []);
});

test("the shared field classes carry the ring, in the colour of the state they are in", () => {
  const form = readFileSync(path.join(SRC, "components", "form.tsx"), "utf8");
  assert.match(form, /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/);
  const retire = readFileSync(path.join(SRC, "app", "nodes", "[name]", "retire-node.tsx"), "utf8");
  assert.match(retire, /focus-visible:outline-danger/);
});
