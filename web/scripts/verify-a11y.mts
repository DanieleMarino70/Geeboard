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
/* "localhost", not the loopback address: a dev server refuses the requests a page makes for its own scripts when it is reached under a name it
   was not started on ("Blocked cross-origin request to Next.js dev resource"), so the page is drawn and never taken over, and every
   check here would be of HTML that no person is ever left looking at. */
const HOST = "localhost";
const BASE = `http://${HOST}:${PORT}`;
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
// What a page said in its console, an error or a warning or an exception, on the way to being taken over by its scripts.
const said: string[] = [];

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
      if (route.signedIn) await tab.setCookie("gb_session", cookie, HOST);
      await tab.setCookie("gb-theme", theme, HOST);
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
      for (const text of tab.problems()) said.push(`${route.at}: ${text}`);
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
    await tab.setCookie("gb_session", cookie, HOST);
    await tab.setCookie("gb-theme", theme, HOST);
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
      if (at !== "/sign-in") await tab.setCookie("gb_session", cookie, HOST);
      await tab.setCookie("gb-theme", theme, HOST);
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
    await tab.setCookie("gb_session", cookie, HOST);
    await tab.setCookie("gb-theme", theme, HOST);
    for (const anchor of ["delete", "move"]) {
      await tab.goto(`${BASE}/settings?server=aurora#${anchor}`, 900);
      const top = await tab.eval<number>(`document.getElementById(${JSON.stringify(anchor)})?.getBoundingClientRect().top ?? -1`);
      check(`${theme}: #${anchor} lands below the 56 px top bar (at ${Math.round(top)} px)`, top >= 56, String(top));
    }
  }

  /* A phone, whatever A11Y_WIDTHS says: the pages the sidebar lists are reached from a bar of five, so this is what shows that the rest are
     there at all. A tap is a click on what is under the middle of the element, so something drawn over it (the bar, a dialog) is a failure
     and not a pass. */
  console.log("\n== a phone ==");
  const asOwner = async () => {
    await tab.call("Network.clearBrowserCookies");
    await tab.setCookie("gb_session", cookie, HOST);
    await tab.setCookie("gb-theme", "dark", HOST);
  };
  const tap = (find: string) =>
    tab.eval<string>(`(async () => {
      const el = (${find});
      if (!el) return "it is not there";
      // A click before React has taken the page over does nothing: a person's tap waits for it too, by the page being slower than a finger.
      for (let i = 0; i < 50 && !Object.keys(el).some((k) => k.startsWith("__reactProps$")); i++) await new Promise((r) => setTimeout(r, 100));
      if (!Object.keys(el).some((k) => k.startsWith("__reactProps$"))) return "the page did not start";
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return "it is not drawn";
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit))) return "covered by " + (hit ? hit.tagName + " " + (hit.textContent || "").trim().slice(0, 30) : "nothing");
      el.click();
      return "ok";
    })()`);
  const arrived = async (href: string) => {
    for (let i = 0; i < 80; i++) {
      if ((await tab.eval<string>("location.pathname")) === href) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const MORE = `Array.from(document.querySelectorAll("nav button")).find((b) => b.textContent.trim() === "More")`;
  const barLink = (href: string) => `Array.from(document.querySelectorAll('nav[aria-label="Primary"] a')).find((a) => a.getAttribute("href") === ${JSON.stringify(href)} && a.getBoundingClientRect().width > 0)`;

  await tab.viewport(1280, 900);
  await asOwner();
  await tab.goto(`${BASE}/`, 600);
  const entries = await tab.eval<string[]>(`(() => {
    const side = Array.from(document.querySelectorAll('nav[aria-label="Primary"]')).find((n) => n.getBoundingClientRect().width > 0);
    return Array.from(side.querySelectorAll("a")).map((a) => a.getAttribute("href")).filter((h) => h && h !== "/account");
  })()`);
  check(`the sidebar lists the owner's pages (${entries.length})`, entries.length >= 17, entries.join(" "));

  for (const width of [375, 768]) {
    await tab.viewport(width, 800, width < 700);
    const lost: string[] = [];
    let twoTaps = 0;
    for (const href of entries) {
      await asOwner();
      await tab.goto(`${BASE}/account`, 500);
      let taps = 0;
      let how = await tap(barLink(href));
      if (how === "ok") taps = 1;
      else {
        how = await tap(MORE);
        if (how === "ok") {
          taps = 1;
          for (let i = 0; i < 20 && !(await tab.eval<boolean>(`Boolean(document.querySelector("dialog[open]"))`)); i++) await new Promise((r) => setTimeout(r, 100));
          how = await tap(`document.querySelector('dialog[open] a[href=${JSON.stringify(href)}]')`);
          if (how === "ok") taps = 2;
        }
      }
      if (taps > 0 && how === "ok" && (await arrived(href))) twoTaps++;
      else lost.push(`${href} (${how})`);
    }
    check(`at ${width} px every page the sidebar lists is within two taps (${twoTaps} of ${entries.length})`, lost.length === 0, lost.join(", "));

    await asOwner();
    await tab.goto(`${BASE}/servers`, 500);
    const hop = await tap(`document.querySelector('header a[aria-label="Your account"]')`);
    check(`at ${width} px the account page is one tap from the avatar`, hop === "ok" && (await arrived("/account")), hop);

    // Where you are is marked even when the page is one the bar does not name.
    await tab.goto(`${BASE}/members`, 500);
    const marked = await tab.eval<boolean>(`(() => { const b = ${MORE}; return Boolean(b) && b.className.includes("text-accent"); })()`);
    check(`at ${width} px the sixth item is marked on a page it holds`, marked === true);
  }

  // Reflow: at the narrowest width asked of a page (WCAG 1.4.10) these three were wider than the window and cut the member's name to nothing.
  for (const width of [375, 320]) {
    await tab.viewport(width, 800, true);
    for (const at of ["/members", "/api-keys", "/audit"]) {
      await asOwner();
      await tab.goto(`${BASE}${at}`, 700);
      const size = await tab.eval<{ scroll: number; client: number }>(`({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })`);
      check(`at ${width} px ${at} is not wider than the window (${size.scroll} of ${size.client})`, size.scroll <= size.client, JSON.stringify(size));
      if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, `phone-${width}-${at.replaceAll("/", "")}.png`));
    }
    await asOwner();
    await tab.goto(`${BASE}/members`, 700);
    const name = await tab.eval<number>(`(() => { const e = Array.from(document.querySelectorAll("main div")).find((d) => d.children.length === 0 && d.textContent === "mara@ashfold.gg"); return e ? Math.round(e.getBoundingClientRect().width) : -1; })()`);
    check(`at ${width} px a member's address has room on /members (${name} px)`, name >= 120, String(name));
    await tab.goto(`${BASE}/servers`, 700);
    const captions = await tab.eval<string>(`(() => { const row = document.querySelector('main a[href^="/servers/"]:not([href="/servers/new"])'); return row ? row.innerText : ""; })()`);
    check(`at ${width} px a server's row says what its figures are`, /CPU/.test(captions) && /RAM/.test(captions) && /Players/.test(captions), captions.replaceAll("\n", " | "));
  }
  if (process.env.A11Y_SHOTS) {
    await tab.viewport(375, 800, true);
    await asOwner();
    await tab.goto(`${BASE}/servers`, 700);
    await tab.shot(path.join(process.env.A11Y_SHOTS, "phone-375-servers.png"));
    await tap(MORE);
    await new Promise((r) => setTimeout(r, 500));
    await tab.shot(path.join(process.env.A11Y_SHOTS, "phone-375-more.png"));
    // The same three pages where the table is back, to see that the rows a phone stacks are still a table there.
    for (const width of [1280, 1024, 768]) {
      await tab.viewport(width, 900);
      for (const at of ["/members", "/api-keys", "/audit", "/servers"]) {
        await asOwner();
        await tab.goto(`${BASE}${at}`, 700);
        await tab.shot(path.join(process.env.A11Y_SHOTS, `wide-${width}-${at.replaceAll("/", "")}.png`));
      }
    }
  }

  // The sidebar stays on screen while the page goes by: its account row is the one place the keyboard-less visitor signs out from.
  await tab.viewport(1280, 900);
  await asOwner();
  await tab.goto(`${BASE}/servers`, 600);
  await tab.eval(`(() => { const s = document.createElement("div"); s.style.height = "3000px"; document.getElementById("main").appendChild(s); window.scrollTo(0, 1200); })()`);
  await new Promise((r) => setTimeout(r, 300));
  const side = await tab.eval<{ top: number; bottom: number; height: number; y: number }>(`(() => { const n = Array.from(document.querySelectorAll('nav[aria-label="Primary"]')).find((x) => x.getBoundingClientRect().width > 0).getBoundingClientRect(); return { top: Math.round(n.top), bottom: Math.round(n.bottom), height: window.innerHeight, y: Math.round(window.scrollY) }; })()`);
  check(`at 1280 px the sidebar is still in the window after the page scrolled ${side.y} px (${side.top}..${side.bottom} of ${side.height})`, side.y > 500 && side.top === 0 && side.bottom === side.height, JSON.stringify(side));

  // A click on the sidebar replaces the sidebar, and with it the link that had focus: focus is put on the new page's main region (P23), and
  // only then, not on the first load of the document.
  await tab.goto(`${BASE}/servers`, 600);
  await new Promise((r) => setTimeout(r, 400));
  const onLoad = await tab.eval<string>("document.activeElement?.tagName ?? ''");
  check(`a page just loaded does not have focus put anywhere (${onLoad})`, onLoad === "BODY", onLoad);
  const clicked = await tap(barLink("/nodes"));
  const reached = clicked === "ok" && (await arrived("/nodes"));
  await new Promise((r) => setTimeout(r, 500));
  const landed = await tab.eval<string>("document.activeElement?.id ?? ''");
  check(`after a click on the sidebar, focus is on the new page's main region (${clicked}, ${landed || "nowhere"})`, reached && landed === "main", clicked);

  console.log("\n== what has been fixed stays fixed ==");
  for (const rule of MUST_BE_ZERO) {
    const entry = byRule.get(rule);
    check(`${rule}: no violation on any route, in either theme`, !entry, entry ? `${entry.count} on ${[...entry.routes].slice(0, 6).join(", ")}` : "");
  }
  const twins = [...titles].filter(([, routes]) => routes.length > 1);
  check("no two routes in the tabs say the same", twins.length === 0, twins.map(([t, r]) => `"${t}": ${r.join(" ")}`).join("; "));
  check("and none says only the name of the product", ![...titles.keys()].includes("Geeboard"), JSON.stringify([...titles].filter(([t]) => t === "Geeboard")));
  check(`no page is wider than the window (${widths.join(", ")} px)`, wide.length === 0, wide.join(", "));
  const threw = said.filter((s) => s.includes(": exception: "));
  check("no page threw while it was taken over by its scripts", threw.length === 0, threw.slice(0, 4).join(" | "));
  for (const line of [...new Set(said.filter((s) => !s.includes(": exception: ")))].slice(0, 8)) console.log(`  note ${line.slice(0, 200)}`);

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
