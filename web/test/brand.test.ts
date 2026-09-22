import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { MARK_PATH } from "../src/components/brand-mark";

/* The mark is drawn once, in brand/geeboard-mark.svg, and the panel keeps
   a copy of its path because the panel's image is built from web/ alone:
   a file outside that directory is not in the build context, so the
   component cannot read it. A copy that nobody checks is a copy that goes
   stale, and a logo that is almost the logo is worse than no logo — so
   this reads both and refuses the difference.

   It runs from a checkout, where brand/ is two directories up. It is not
   run inside the image, which is the point. */

const brandDir = join(import.meta.dirname, "..", "..", "brand");

function pathOf(file: string) {
  const svg = readFileSync(join(brandDir, file), "utf8");
  const match = svg.match(/<path[^>]*\sd="([^"]+)"/);
  assert.ok(match, `${file} has no path to read`);
  return match[1];
}

test("the panel's mark is the mark in brand/", () => {
  assert.equal(MARK_PATH, pathOf("geeboard-mark.svg"));
});

test("the brand green version is the same shape", () => {
  assert.equal(pathOf("geeboard-mark-brand.svg"), pathOf("geeboard-mark.svg"));
});

test("the mark carries no colour of its own", () => {
  const svg = readFileSync(join(brandDir, "geeboard-mark.svg"), "utf8");
  assert.match(svg, /fill="currentColor"/);
  assert.doesNotMatch(
    svg,
    /#[0-9a-fA-F]{3,6}/,
    "the one-colour mark takes its colour from whatever it sits in",
  );
});

/* Nothing stands in for the mark any more.

   Before there was a mark, every screen that said "Geeboard" said it
   beside a lucide lightning bolt in a lime square. The mark landed in the
   sidebar and on the sign-in page, and three screens kept the
   placeholder: the second step of signing in, the page a one-time link
   lands on, and the create wizard's own header — the three a person is
   least often looking at and most likely to be looking at for the first
   time. Nobody noticed for a release.

   So the shape of that placeholder is what this looks for: an icon in a
   filled accent badge, immediately followed by the wordmark. */
const srcDir = join(import.meta.dirname, "..", "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/* A badge — an element whose class list fills it with the accent — then
   any element, then the wordmark, with only markup in between. */
const PLACEHOLDER = /bg-accent[^>]*text-accent-ink[^>]*>\s*<[A-Z][^>]*\/>\s*<\/\w+>\s*<span[^>]*>Geeboard</;

test("no screen wears a placeholder where the mark belongs", () => {
  const wearing = tsxFiles(srcDir).filter((file) =>
    PLACEHOLDER.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    wearing.map((file) => file.slice(srcDir.length + 1)),
    [],
    "these say Geeboard beside something that is not the mark — use <BrandMark />",
  );
});

test("every screen that says Geeboard shows the mark with it", () => {
  const missing = tsxFiles(srcDir).filter((file) => {
    const source = readFileSync(file, "utf8");
    return /<span[^>]*>Geeboard<\/span>/.test(source) && !source.includes("BrandMark");
  });
  assert.deepEqual(
    missing.map((file) => file.slice(srcDir.length + 1)),
    [],
    "the wordmark without the mark beside it",
  );
});
