import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bare, sentences } from "../src/domain/text.ts";

/* A message the panel shows is built from parts written apart, and some are somebody else's: an error's own text, a node's answer. Twelve
   places appended a full stop to a message that might already end in one, and a person read "…its world is intact.." — or, once, "intact and
   backup complete is locked". `bare` takes a part to where a sentence of the panel's own can continue it. */

test("bare takes the full stops and the white space off the end, and nothing from the middle", () => {
  assert.equal(bare("Port 25565 is in use."), "Port 25565 is in use");
  assert.equal(bare("it said so... "), "it said so");
  assert.equal(bare("no stop"), "no stop");
  assert.equal(bare("version 1.20.6 is not there."), "version 1.20.6 is not there");
  assert.equal(bare(""), "");
});

test("sentences ends each part with one full stop whether or not it came with one, and leaves out the empty", () => {
  assert.equal(sentences("It failed.", "Nothing was changed"), "It failed. Nothing was changed.");
  assert.equal(sentences("It failed", null, "", false, "Try again."), "It failed. Try again.");
  assert.equal(sentences(), "");
  assert.doesNotMatch(sentences("a..", "b. "), /\.\./);
});

/* The source is read for the mistake itself: a message interpolated in front of a full stop of the panel's own, without bare(). A sentence
   built that way is right only for the messages that happen not to end in one. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) sourceFiles(file, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(file);
  }
  return out;
}

test("no message is put in front of a full stop of the panel's own without bare()", () => {
  const unguarded = /\$\{(?!bare\()(?:[A-Za-z_][\w.]*\.(?:message|reason|body|detail|sentence)|\(error as Error\)\.message|reason|message|sentence)\}\./;
  const handMade = /\.replace\(\/\\\.\$\/, ""\)/;
  const found: string[] = [];
  for (const file of sourceFiles(path.join(import.meta.dirname, "..", "src"))) {
    if (file.endsWith(`${path.sep}domain${path.sep}text.ts`)) continue;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (unguarded.test(line)) found.push(`${path.relative(path.join(import.meta.dirname, ".."), file)}:${i + 1}: a message before a full stop, without bare()`);
        // A DNS name's trailing dot (an SRV target, a record's content) is not a sentence's.
        if (handMade.test(line) && !file.includes(`${path.sep}dns${path.sep}`)) found.push(`${path.relative(path.join(import.meta.dirname, ".."), file)}:${i + 1}: a hand-made bare()`);
      });
  }
  assert.deepEqual(found, []);
});
