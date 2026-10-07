import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { block, over, parseHsl, ratio, resolve, tokens, type Theme } from "./contrast-lib.ts";

/* The colours of the panel, computed from globals.css. Text must reach 4.5:1 (WCAG 1.4.3) against what it is written on, a control's edge and
   the colours that say what state a thing is in 3:1 (1.4.11). The numbers in the audit were these, by hand: the light theme's primary button
   at 4.01, its status text on a card at 3.5 to 4.2, a field's edge at 1.2 to 1.3 against the card it is on, the console's light-theme
   status colours at 2.8 to 4.1 on a surface that stays dark. A token that is edited so that one of them is below the line fails here. */

const SURFACES = ["--bg", "--bg-2", "--surface", "--card", "--card-2"] as const;
const STATUS = ["accent", "success", "warning", "danger", "info"] as const;
const THEMES: Theme[] = ["dark", "light"];
const TEXT = 4.5;
const NON_TEXT = 3;

const fmt = (n: number) => n.toFixed(2);

for (const theme of THEMES) {
  const t = tokens(theme);

  test(`${theme}: the four inks reach ${TEXT}:1 on every surface`, () => {
    const low: string[] = [];
    for (const ink of ["--ink", "--ink-2", "--ink-3", "--ink-4"]) {
      for (const surface of SURFACES) {
        const r = ratio(resolve(t, ink), resolve(t, surface));
        if (r < TEXT) low.push(`${ink} on ${surface} ${fmt(r)}`);
      }
    }
    // The unselected cells of a segmented control sit on the hairline colour, and are written in ink-3 (ink-4 is not enough there).
    for (const ink of ["--ink", "--ink-2", "--ink-3"]) {
      const r = ratio(resolve(t, ink), resolve(t, "--border"));
      if (r < TEXT) low.push(`${ink} on --border ${fmt(r)}`);
    }
    assert.deepEqual(low, []);
  });

  test(`${theme}: text in a status colour reaches ${TEXT}:1 on every surface and on its own tint over each`, () => {
    const low: string[] = [];
    for (const name of STATUS) {
      const fg = resolve(t, `--${name}-fg`);
      for (const surface of SURFACES) {
        const base = resolve(t, surface);
        const plain = ratio(fg, base);
        if (plain < TEXT) low.push(`${name}-fg on ${surface} ${fmt(plain)}`);
        const tinted = ratio(fg, over(parseHsl(t[`--${name}-soft`]!), base));
        if (tinted < TEXT) low.push(`${name}-fg on ${name}-soft over ${surface} ${fmt(tinted)}`);
      }
      // The cells of a segmented control that are not selected show the container, which is the hairline colour.
      const onHairline = ratio(fg, resolve(t, "--border"));
      if (onHairline < TEXT) low.push(`${name}-fg on --border ${fmt(onHairline)}`);
    }
    assert.deepEqual(low, []);
  });

  test(`${theme}: the primary button's label reaches ${TEXT}:1 on its fill and on the hover fill`, () => {
    for (const fill of ["--accent", "--accent-2"]) {
      const r = ratio(resolve(t, "--accent-ink"), resolve(t, fill));
      assert.ok(r >= TEXT, `--accent-ink on ${fill} ${fmt(r)}`);
    }
  });

  test(`${theme}: the edge of a control reaches ${NON_TEXT}:1 against every surface it can be on`, () => {
    const low: string[] = [];
    for (const surface of SURFACES) {
      const r = ratio(resolve(t, "--control-border"), resolve(t, surface));
      if (r < NON_TEXT) low.push(`${surface} ${fmt(r)}`);
    }
    assert.deepEqual(low, []);
  });

  test(`${theme}: a status fill, as a dot or a bar, reaches ${NON_TEXT}:1 against the card and the page`, () => {
    const low: string[] = [];
    for (const name of STATUS) {
      for (const surface of ["--card", "--bg"]) {
        const r = ratio(resolve(t, `--${name}`), resolve(t, surface));
        if (r < NON_TEXT) low.push(`${name} on ${surface} ${fmt(r)}`);
      }
    }
    assert.deepEqual(low, []);
  });

  test(`${theme}: every step of the heat map reaches ${NON_TEXT}:1 against the card, and each is stronger than the last`, () => {
    const accent = parseHsl(t["--accent"]!);
    const card = resolve(t, "--card");
    let before = 0;
    for (const step of [1, 2, 3, 4]) {
      const alpha = Number(t[`--heat-${step}`]);
      assert.ok(alpha > before, `--heat-${step} is not stronger than the step before`);
      before = alpha;
      const r = ratio(over({ ...accent, a: alpha }, card), card);
      assert.ok(r >= NON_TEXT, `--heat-${step} ${fmt(r)}`);
    }
  });

  test(`${theme}: the label is readable on the card that carries the text of a selected row`, () => {
    // A selected row or chip is the accent tint over its card, with the ink on it.
    for (const ink of ["--ink", "--ink-2", "--ink-3"]) {
      const r = ratio(resolve(t, ink), over(parseHsl(t["--accent-soft"]!), resolve(t, "--card")));
      assert.ok(r >= TEXT, `${ink} on the selected tint ${fmt(r)}`);
    }
  });
}

/* A surface that is dark in both themes (the console, the terminal, the audit diff) says so with .gb-dark-surface, which re-declares the dark
   values: what is written there is checked against the dark tokens in either theme. */
test("a dark surface reads the same in both themes: its text reaches 4.5:1 on the console's own background", () => {
  const dark = tokens("dark");
  const low: string[] = [];
  const bg = resolve(dark, "--con-bg");
  for (const ink of ["--con-ink", "--con-dim", "--ink-2", "--ink-3", "--ink-4", "--accent-fg", "--success-fg", "--warning-fg", "--danger-fg", "--info-fg"]) {
    const r = ratio(resolve(dark, ink), bg);
    if (r < TEXT) low.push(`${ink} ${fmt(r)}`);
  }
  assert.deepEqual(low, []);
});

test("a first visit from a machine set to light gets the light map, word for word", () => {
  const css = readFileSync(path.join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
  assert.match(css, /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)/);
  const light = block(css, /^\[data-theme="light"\]\s*\{/m);
  const first = block(css, /^\s*:root:not\(\[data-theme\]\)\s*\{/m);
  assert.deepEqual(first, light);
});

const SRC = path.join(import.meta.dirname, "..", "src");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) files(file, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(file);
  }
  return out;
}

test("text in a status colour is written with the -fg token: the colour itself is for fills", () => {
  const bare: string[] = [];
  for (const file of files(SRC)) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/(?<![\w-])(?:[a-z0-9[\]_()&>*:-]+:)*text-(accent|success|warning|danger|info)(?![\w-])/.test(line)) bare.push(`${path.relative(SRC, file)}:${i + 1}`);
      });
  }
  assert.deepEqual(bare, [], "use text-accent-fg, text-success-fg, text-warning-fg, text-danger-fg, text-info-fg");
});

test("a surface that is dark in both themes says so: bg-con-bg comes with gb-dark-surface, which gives it the dark tokens", () => {
  const plain: string[] = [];
  for (const file of files(SRC)) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/(?<![\w-])bg-con-bg(?![\w-])/.test(line) && !/gb-dark-surface/.test(line)) plain.push(`${path.relative(SRC, file)}:${i + 1}`);
      });
  }
  assert.deepEqual(plain, []);
});

test("a field's edge is the control border, not the hairline that divides a card", () => {
  const weak: string[] = [];
  for (const file of files(SRC)) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        // A text field, select or textarea says it is one by taking the ring on focus; its class string is the one to look at.
        if (/focus-(visible|within):outline-2/.test(line) && /\bbg-bg-2\b/.test(line) && /(?<![\w-])border-line(?![\w-])/.test(line)) weak.push(`${path.relative(SRC, file)}:${i + 1}`);
      });
  }
  assert.deepEqual(weak, [], "use border-control (and hover:border-ink-4) on the edge of a field");
});
