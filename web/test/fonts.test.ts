import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* The panel's two typefaces are copies of the documentation site's.

   The panel's image is built from web/ alone, so it cannot read
   docs-src/assets/fonts, and it used to fetch the same two families from
   Google Fonts on every build instead — which made a build depend on
   Google answering, and on Google answering in a shape Turbopack could
   rewrite. So the files are copied in, and a copy that nobody checks is a
   copy that forks: the panel and its documentation drawn in two slightly
   different Geists is the failure this refuses.

   It runs from a checkout, where docs-src/ is two directories up. */

const site = join(import.meta.dirname, "..", "..", "docs-src", "assets", "fonts");
const panel = join(import.meta.dirname, "..", "src", "app", "fonts");

const FILES = ["geist-variable.woff2", "jetbrains-mono-variable.woff2"];
const LICENCES = ["Geist-LICENSE.txt", "JetBrainsMono-LICENSE.txt"];

test("the panel's fonts are byte for byte the documentation site's", () => {
  for (const file of FILES) {
    assert.ok(readFileSync(join(panel, file)).equals(readFileSync(join(site, file))), `${file} differs from docs-src's`);
  }
});

test("each font travels with its licence", () => {
  // The SIL Open Font License asks for the licence to go wherever the font goes.
  for (const licence of LICENCES) {
    assert.ok(existsSync(join(panel, licence)), `${licence} is missing beside the panel's fonts`);
    assert.match(readFileSync(join(panel, licence), "utf8"), /SIL Open Font License, Version 1\.1/);
  }
});

const layout = readFileSync(join(import.meta.dirname, "..", "src", "app", "layout.tsx"), "utf8");

test("the layout loads them from the repository, not from Google Fonts", () => {
  assert.doesNotMatch(layout, /from\s+["']next\/font\/google["']/);
  for (const file of FILES) assert.ok(layout.includes(`./fonts/${file}`), `layout.tsx does not load ${file}`);
});

test("the font variables are set on <html>, where the theme's --font-sans reads them", () => {
  /* globals.css defines --font-sans on :root as var(--font-geist). Set on
     <body>, the variable was not there when :root resolved it, and every
     page fell back to the browser's sans without a word. */
  const html = layout.match(/<html\s+lang=[\s\S]*?>/)?.[0] ?? "";
  assert.match(html, /geist\.variable/);
  assert.match(html, /jetbrains\.variable/);
  const css = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
  assert.match(css, /--font-sans:\s*var\(--font-geist\)/);
});
