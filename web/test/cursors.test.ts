import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* A button that does something looked like text until it was pressed: Tailwind's preflight gives a <button> the arrow. The cursors are said
   once, in the base layer of globals.css, and these tests keep them said — the browser check (`npm run verify:a11y`) measures what they
   come to on the computed style. And a disabled Button must be able to show its "not-allowed", which a `pointer-events: none` takes away:
   the pointer goes through it to whatever is underneath. */

const SRC = path.join(import.meta.dirname, "..", "src");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const ui = readFileSync(path.join(SRC, "components", "ui.tsx"), "utf8");

function rule(selectorStart: string): string {
  const at = css.indexOf(selectorStart);
  assert.ok(at >= 0, `globals.css has no rule starting ${selectorStart}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return `${css.slice(at, open)} ${css.slice(open + 1, close)}`;
}

test("what acts under a click is a hand, in the base layer", () => {
  const hand = rule("button:not(:disabled),");
  for (const s of ["summary", "label[for]", "select:not(:disabled)", "a[href]", '[role="button"]', '[role="tab"]', 'type="checkbox"', 'type="range"']) {
    assert.ok(hand.includes(s), `the hand rule does not name ${s}`);
  }
  assert.match(hand, /cursor:\s*pointer/);
});

test("a field is an I-beam and what is off is a no", () => {
  assert.match(rule("textarea:not(:disabled),"), /cursor:\s*text/);
  const off = rule("button:disabled,");
  assert.ok(off.includes("input:disabled") && off.includes('[aria-disabled="true"]'));
  assert.match(off, /cursor:\s*not-allowed/);
  assert.match(rule('[aria-busy="true"]'), /cursor:\s*progress/);
});

test("the cursors are in the base layer, so one utility on one element can still say otherwise", () => {
  const base = css.indexOf("@layer base");
  const hand = css.indexOf("button:not(:disabled),");
  assert.ok(base >= 0 && hand > base, "the cursor rules are not inside @layer base");
});

test("a disabled Button is not taken out of the pointer's way", () => {
  assert.ok(!/disabled:pointer-events-none/.test(ui), "ui.tsx still has disabled:pointer-events-none on the Button, which hides its not-allowed cursor and its title");
  // Hover and press are for a button that can be pressed; an anchor (LinkButton) is never :disabled, so `not-disabled:` and not `enabled:`.
  assert.ok(/not-disabled:hover:/.test(ui) && /not-disabled:active:/.test(ui));
  assert.ok(!/(^|[\s"])hover:brightness-110/.test(ui.slice(ui.indexOf("const INTENT"), ui.indexOf("const SIZE"))), "an intent's hover is not guarded against disabled");
});

test("movement is for a person who has not asked for less, and never moves the layout", () => {
  const no = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(no >= 0, "no entrance animation is behind prefers-reduced-motion: no-preference");
  const block = css.slice(no, css.indexOf("\n}\n", no));
  assert.match(block, /#main\s*\{[^}]*gbFade/, "#main takes the fade");
  assert.match(block, /dialog\[open\]\s*\{[^}]*gbPop/);
  // Only opacity and transform (and a duration well under a quarter of a second) in what comes in.
  const keyframes = css.slice(css.indexOf("@keyframes gbFade"), css.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(!/(width|height|top|left|margin|padding)\s*:/.test(keyframes), "an entrance animates a property that moves the layout");
  for (const m of block.matchAll(/gb(?:Fade|Pop)\s+(\d+)ms/g)) assert.ok(Number(m[1]) <= 200, `an entrance takes ${m[1]} ms`);
  // `#main` never gets a transform: it would become the containing block of everything fixed inside it.
  assert.ok(!/@keyframes gbFade[^}]*transform/.test(css), "gbFade moves #main with a transform");
  assert.ok(!/#main\s*\{[^}]*transform/.test(css));
});

test("no component hand-writes a cursor over a control without meaning it", () => {
  // cursor-pointer on a <button> or <a> is noise the base layer made unnecessary; it stays on elements that are not controls by themselves
  // (a summary, a label, a div with a role). Listed so a new one is a decision.
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx$/.test(name)) {
        readFileSync(file, "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (/<button\b[^>]*cursor-pointer/.test(line)) found.push(`${path.relative(SRC, file)}:${i + 1}`);
          });
      }
    }
  };
  walk(SRC);
  assert.deepEqual(found, [], "a <button> says cursor-pointer by hand; the base layer does it");
});
