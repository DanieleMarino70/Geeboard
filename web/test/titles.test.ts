import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* Every page has a title, and no two say the same: the browser tab, the history, a bookmark, and the route announcement a screen reader
   hears when a navigation ends, which Next speaks only when the title changed. All but three pages said "Geeboard". A page that is added
   without one fails here, and so does one that copies another's. */

const APP = path.join(import.meta.dirname, "..", "src", "app");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) pages(file, out);
    else if (name === "page.tsx") out.push(file);
  }
  return out;
}

const route = (file: string) => path.relative(APP, path.dirname(file)).replaceAll(path.sep, "/") || "/";

test("every page has a title of its own, a static one or one made from its address", () => {
  const missing: string[] = [];
  const statics = new Map<string, string[]>();
  for (const file of pages(APP)) {
    const text = readFileSync(file, "utf8");
    const dynamic = /export (async )?function generateMetadata\b/.test(text);
    const fixed = /export const metadata\s*(:\s*\w+\s*)?=\s*\{[^}]*title:\s*(["'`])([^"'`]+)\2/.exec(text);
    if (!dynamic && !fixed) {
      missing.push(route(file));
      continue;
    }
    if (fixed) statics.set(fixed[3]!, [...(statics.get(fixed[3]!) ?? []), route(file)]);
  }
  assert.deepEqual(missing, [], "a page without a title");
  const twins = [...statics].filter(([, routes]) => routes.length > 1).map(([title, routes]) => `${title}: ${routes.join(", ")}`);
  assert.deepEqual(twins, [], "two pages with one title");
});

test("the template adds the name once, so no page's own title carries it", () => {
  const layout = readFileSync(path.join(APP, "layout.tsx"), "utf8");
  assert.match(layout, /template:\s*"%s · Geeboard"/);
  for (const file of pages(APP)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /title:\s*["'`][^"'`]*Geeboard/, `${route(file)} names the product in its own title, and the template does it again`);
  }
});
