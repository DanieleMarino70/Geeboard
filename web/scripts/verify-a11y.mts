import "./load-env.mts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { SignJWT } from "jose";
import { findBrowser, launchBrowser, type Tab } from "./browser.mts";
import { startPanel, stopPanel, waitForPanel, type Panel } from "./verify-panel.mts";

/* The panel's pages as a person using a keyboard, a screen reader or a phone meets them, checked by axe-core in a real browser: every route,
   both themes, at the widths asked for (A11Y_WIDTHS, default 1280; add 375 and 320 for a phone).

   Three kinds of answer, on purpose. MUST_BE_ZERO are the rules that have been fixed: any violation fails, and this is what keeps them fixed.
   The baseline (scripts/a11y-baseline.json) is what is known and not yet fixed, by rule: more of one fails, fewer is said and is for
   \`--update\` to write down. Everything else axe finds is printed. The overflow check is separate from axe, which does not look for it: the page
   is not wider than the window, at any width asked for.

   Needs a browser (GEEBOARD_CHROME names one; Chrome, Edge and Chromium are looked for) and the verification database. With no browser it says
   so and passes nothing. axe-core is the copy the linter already brings (eslint-plugin-jsx-a11y). */

const require = createRequire(import.meta.url);
const BASELINE = path.join(import.meta.dirname, "a11y-baseline.json");
const update = process.argv.includes("--update");
const widths = (process.env.A11Y_WIDTHS ?? "1280").split(",").map((w) => Number(w.trim())).filter((w) => w > 0);

/* Fixed, and kept so. P23: a title for every page, a way past the sidebar, one main region on each page, a heading to start from, and a
   scrolling region the keyboard can reach. */
const MUST_BE_ZERO = ["document-title", "bypass", "landmark-one-main", "landmark-no-duplicate-main", "landmark-unique", "page-has-heading-one", "scrollable-region-focusable"];

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${detail}`);
  }
};

const executable = findBrowser();
if (!executable) {
  console.log("skipped: no browser found (Chrome, Edge or Chromium; GEEBOARD_CHROME names one). Nothing was checked.");
  process.exit(0);
}
let axeSource: string;
try {
  axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
} catch {
  console.log("skipped: axe-core is not installed. Nothing was checked.");
  process.exit(0);
}

const { db } = await import("../src/lib/db");
const { seed } = await import("../prisma/seed");
const account = await import("../src/lib/account-ops");
const { base32Decode, totp } = await import("../src/domain/access/totp");

const SESSION_SECRET = process.env.SESSION_SECRET!;
const PORT = 3300 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const env: Record<string, string | undefined> = { ...process.env, GEEBOARD_DIST_DIR: ".next-a11y" };
// A developer's server, whatever this shell had.
delete env.NODE_ENV;

console.log("\n== a panel with the seeded workspace, and its owner signed in with two-factor ==");
await seed();
const mara = (await db.user.findUniqueOrThrow({ where: { email: "mara@ashfold.gg" } }));
const begun = await account.beginTwoFactorOp(mara);
if (!begun.ok || !("secret" in begun)) throw new Error("two-factor did not begin for the owner");
const confirmed = await account.confirmTwoFactorOp((await db.user.findUniqueOrThrow({ where: { id: mara.id } })), totp(base32Decode(begun.secret), Date.now()));
if (!confirmed.ok) throw new Error("two-factor did not confirm for the owner");
const session = await db.session.create({ data: { userId: mara.id, expiresAt: new Date(Date.now() + 3_600_000), userAgent: "verify-a11y" } });
const cookie = await new SignJWT({ sid: session.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SESSION_SECRET));

const revision = await db.gameManifest.findFirst({ select: { id: true } });
/* Every page there is, from the files. A route with a parameter is given one that exists; the page a signed-out visitor sees is checked signed out. */
const ROUTES: Array<{ at: string; signedIn: boolean }> = [
  ["/", true], ["/account", true], ["/activity", true], ["/analytics", true], ["/api-keys", true], ["/audit", true], ["/backups", true], ["/console", true],
  ["/dns", true], ["/files", true], ["/games", true], ["/games/community", true], ["/marketplace", true], ["/members", true], ["/mods", true], ["/nodes", true],
  ["/nodes/fra-node-02", true], ["/notifications", true], ["/players", true], ["/plugins", true], ["/scheduler", true], ["/servers", true], ["/servers/aurora", true],
  ["/servers/new", true], ["/settings", true], ["/templates", true], ["/terminal", true], ["/sign-in", false], ["/setup/not-a-real-link", false],
  ...(revision ? ([[`/games/community/${revision.id}`, true]] as const) : []),
].map(([at, signedIn]) => ({ at: at as string, signedIn: signedIn as boolean }));

let panel: Panel | undefined;
const browser = await launchBrowser(executable);
interface Found { rule: string; impact: string | null; route: string; theme: string; width: number; nodes: number; help: string }
const found: Found[] = [];
const wide: string[] = [];
const titles = new Map<string, string[]>();

try {
  panel = startPanel(PORT, env as NodeJS.ProcessEnv);
  await waitForPanel(panel, BASE);
  check("the panel starts", true);

  const tab: Tab = await browser.open();
  const run = async (theme: "dark" | "light", width: number) => {
    await tab.viewport(width, width < 700 ? 800 : 900, width < 700);
    for (const route of ROUTES) {
      // Signed in or not is the cookie, and the theme is the theme's: both are cookies of this panel.
      await tab.call("Network.clearBrowserCookies");
      if (route.signedIn) await tab.setCookie("gb_session", cookie, "127.0.0.1");
      await tab.setCookie("gb-theme", theme, "127.0.0.1");
      await tab.goto(`${BASE}${route.at}`, 600);
      const at = (await tab.eval<string>("location.pathname")) as string;
      if (route.signedIn && at !== route.at.split("?")[0]) {
        // Sent elsewhere (a page that needs something this workspace has not): not a page to check, and said.
        console.log(`  skip ${route.at}: it went to ${at}`);
        continue;
      }
      const result = (await tab.eval(`(async () => {
        ${axeSource}
        const out = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
        return JSON.stringify({ title: document.title, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth, violations: out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })) });
      })()`)) as string;
      const parsed = JSON.parse(result) as { title: string; wide: boolean; violations: Array<{ id: string; impact: string | null; help: string; nodes: number }> };
      if (theme === "dark" && width === widths[0]) titles.set(parsed.title, [...(titles.get(parsed.title) ?? []), route.at]);
      if (parsed.wide) wide.push(`${route.at} at ${width}px`);
      for (const v of parsed.violations) found.push({ rule: v.id, impact: v.impact, route: route.at, theme, width, nodes: v.nodes, help: v.help });
    }
  };
  for (const width of widths) for (const theme of ["dark", "light"] as const) await run(theme, width);

  console.log(`\n== ${ROUTES.length} routes, both themes, at ${widths.join(", ")} px ==`);
  const byRule = new Map<string, { count: number; routes: Set<string>; help: string; impact: string | null }>();
  for (const f of found) {
    const entry = byRule.get(f.rule) ?? { count: 0, routes: new Set<string>(), help: f.help, impact: f.impact };
    entry.count += f.nodes;
    entry.routes.add(f.route);
    byRule.set(f.rule, entry);
  }
  for (const [rule, entry] of [...byRule].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${rule.padEnd(34)} ${String(entry.count).padStart(4)} elements on ${String(entry.routes.size).padStart(2)} routes  (${entry.impact}) ${entry.help}`);
  }

  console.log("\n== a keyboard ==");
  for (const theme of ["dark", "light"] as const) {
    await tab.viewport(1280, 900);
    await tab.call("Network.clearBrowserCookies");
    await tab.setCookie("gb_session", cookie, "127.0.0.1");
    await tab.setCookie("gb-theme", theme, "127.0.0.1");
    await tab.goto(`${BASE}/servers`, 600);
    await tab.press("Tab");
    const first = await tab.eval<string>("document.activeElement?.textContent?.trim() ?? ''");
    check(`${theme}: the first Tab on a page is the link past the sidebar`, first === "Skip to content", first);
    // A picture of it, for whoever has to judge how it looks: A11Y_SHOTS names a directory.
    if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, `skip-link-${theme}.png`));
    await tab.press("Enter");
    check(`${theme}: and it takes the keyboard to the page's main region, two stops from the top`, (await tab.eval<string>("document.activeElement?.id ?? ''")) === "main");
    await tab.press("Tab");
    const inside = await tab.eval<boolean>("document.getElementById('main')?.contains(document.activeElement) ?? false");
    check(`${theme}: the next Tab is inside it, not back in the sidebar`, inside === true);

    // A text field has a ring when it is reached by the keyboard: in both themes, which the border that replaced it did not in the light one.
    for (const [at, selector] of [["/sign-in", 'input[name="email"]'], ["/servers", 'input[name="q"]'], ["/audit", "main input"]] as const) {
      await tab.call("Network.clearBrowserCookies");
      if (at !== "/sign-in") await tab.setCookie("gb_session", cookie, "127.0.0.1");
      await tab.setCookie("gb-theme", theme, "127.0.0.1");
      await tab.goto(`${BASE}${at}`, 600);
      // Tabbed to: a few presses reach it, and the page decides what focus-visible is.
      let ring = "";
      for (let i = 0; i < 80; i++) {
        await tab.press("Tab");
        const on = await tab.eval<string>(`(() => { const e = document.activeElement; if (!e || !e.matches(${JSON.stringify(selector)})) return ""; let s = getComputedStyle(e); /* A field in a bordered wrapper shows the ring on the wrapper that has focus. */ for (let p = e.parentElement; p && p !== document.body && s.outlineStyle === "none"; p = p.parentElement) if (p.matches(":focus-within")) s = getComputedStyle(p); return s.outlineStyle + " " + s.outlineWidth; })()`);
        if (on) {
          ring = on;
          break;
        }
      }
      check(`${theme}: a field on ${at} shows a ring when the keyboard reaches it (${ring.trim() || "not reached"})`, /solid 2px/.test(ring), ring);
      if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, `field-${at.replaceAll("/", "")}-${theme}.png`));
    }

    // An anchor lands clear of the bar that stays on screen.
    await tab.call("Network.clearBrowserCookies");
    await tab.setCookie("gb_session", cookie, "127.0.0.1");
    await tab.setCookie("gb-theme", theme, "127.0.0.1");
    for (const anchor of ["delete", "move"]) {
      await tab.goto(`${BASE}/settings?server=aurora#${anchor}`, 900);
      const top = await tab.eval<number>(`document.getElementById(${JSON.stringify(anchor)})?.getBoundingClientRect().top ?? -1`);
      check(`${theme}: #${anchor} lands below the 56 px top bar (at ${Math.round(top)} px)`, top >= 56, String(top));
    }
  }

  console.log("\n== what has been fixed stays fixed ==");
  for (const rule of MUST_BE_ZERO) {
    const entry = byRule.get(rule);
    check(`${rule}: no violation on any route, in either theme`, !entry, entry ? `${entry.count} on ${[...entry.routes].slice(0, 6).join(", ")}` : "");
  }
  const twins = [...titles].filter(([, routes]) => routes.length > 1);
  check("no two routes in the tabs say the same", twins.length === 0, twins.map(([t, r]) => `"${t}": ${r.join(" ")}`).join("; "));
  check("and none says only the name of the product", ![...titles.keys()].includes("Geeboard"), JSON.stringify([...titles].filter(([t]) => t === "Geeboard")));
  check(`no page is wider than the window (${widths.join(", ")} px)`, wide.length === 0, wide.join(", "));

  console.log("\n== what is known and not yet fixed does not grow ==");
  const baseline: Record<string, number> = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>) : {};
  const now: Record<string, number> = Object.fromEntries([...byRule].filter(([rule]) => !MUST_BE_ZERO.includes(rule)).map(([rule, e]) => [rule, e.count]));
  for (const [rule, count] of Object.entries(now)) {
    const was = baseline[rule];
    if (was === undefined) check(`${rule}: new, ${count}`, update, "not in the baseline; --update writes it down");
    else if (count > was) check(`${rule}: ${count} is more than the ${was} written down`, false);
    else if (count < was) console.log(`  ok   ${rule}: ${count}, down from ${was} (--update writes it down)`);
  }
  for (const rule of Object.keys(baseline)) if (!(rule in now)) console.log(`  ok   ${rule}: gone (--update writes it down)`);
  check("nothing got worse", Object.entries(now).every(([rule, count]) => baseline[rule] === undefined || count <= baseline[rule]!) || update);
  if (update) {
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(Object.entries(now).sort()), null, 2)}\n`);
    console.log(`  the baseline was written: ${Object.keys(now).length} rules`);
  }
} finally {
  await browser.close();
  if (panel) stopPanel(panel);
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
