import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
