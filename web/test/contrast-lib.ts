import { readFileSync } from "node:fs";
import path from "node:path";

/* Contrast, computed from the tokens in globals.css and not from anybody's eye. WCAG 2 relative luminance and the ratio between two colours,
   the tokens of each theme with the light one falling back on the dark one for what it does not redeclare (as the cascade does), and a colour
   with an alpha composited over what it sits on. The panel's colours are all `hsl(h s% l%)` or `hsl(h s% l% / a)`. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Colour extends Rgb {
  a: number;
}

export function parseHsl(text: string): Colour {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(text.trim());
  if (!m) throw new Error(`not an hsl colour: ${text}`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

export function over(top: Colour, bottom: Rgb): Rgb {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  };
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(c: Rgb) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
export function ratio(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Theme = "dark" | "light";

const CSS = path.join(import.meta.dirname, "..", "src", "app", "globals.css");

export function block(css: string, opener: RegExp): Record<string, string> {
  const at = css.search(opener);
  if (at < 0) throw new Error(`no block for ${opener}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** Every token of a theme, as the cascade would give it: the light theme over the dark one. */
export function tokens(theme: Theme, css = readFileSync(CSS, "utf8")): Record<string, string> {
  const dark = block(css, /^:root\b[^{]*\{/m);
  return theme === "dark" ? dark : { ...dark, ...block(css, /^\[data-theme="light"\]\s*\{/m) };
}

/** A token as a colour; `over` is what a translucent one sits on. */
export function resolve(map: Record<string, string>, name: string, on?: Rgb): Rgb {
  const raw = map[name];
  if (!raw) throw new Error(`no token ${name}`);
  const value = raw.startsWith("var(") ? map[/var\((--[\w-]+)\)/.exec(raw)![1]!]! : raw;
  const colour = parseHsl(value);
  return colour.a < 1 ? over(colour, on ?? { r: 255, g: 255, b: 255 }) : { r: colour.r, g: colour.g, b: colour.b };
}
