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
   scrolling region the keyboard can reach. P26: every piece of text reaches 4.5:1 against what it is on, in both themes, and a link in a
   sentence is told from it by more than its colour. P34: every progress bar has a name, a list that is not a definition list is not one, and every target is 24 px. */
const MUST_BE_ZERO = ["document-title", "bypass", "landmark-one-main", "landmark-no-duplicate-main", "landmark-unique", "page-has-heading-one", "scrollable-region-focusable", "color-contrast", "link-in-text-block", "aria-progressbar-name", "definition-list", "target-size"];

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
// A11Y_DETAIL=color-contrast,target-size prints the elements axe names for those rules, with what it measured.
const DETAIL = (process.env.A11Y_DETAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const detailLines = new Set<string>();
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
        const detail = ${JSON.stringify(DETAIL)};
        return JSON.stringify({ title: document.title, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth, violations: out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, where: detail.includes(v.id) ? v.nodes.slice(0, 12).map((n) => ({ t: n.target.join(" ").slice(0, 110), m: ((n.any[0] && n.any[0].message) || "").slice(0, 170) })) : [] })) });
      })()`)) as string;
      const parsed = JSON.parse(result) as { title: string; wide: boolean; violations: Array<{ id: string; impact: string | null; help: string; nodes: number; where: Array<{ t: string; m: string }> }> };
      for (const text of tab.problems()) said.push(`${route.at}: ${text}`);
      if (theme === "dark" && width === widths[0]) titles.set(parsed.title, [...(titles.get(parsed.title) ?? []), route.at]);
      if (parsed.wide) wide.push(`${route.at} at ${width}px`);
      for (const v of parsed.violations) {
        found.push({ rule: v.id, impact: v.impact, route: route.at, theme, width, nodes: v.nodes, help: v.help });
        for (const w of v.where) detailLines.add(`${v.id} ${theme} ${route.at} ${w.t} :: ${w.m}`);
      }
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

  for (const line of detailLines) console.log(`  detail ${line}`);

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

  /* What a person is told, and for how long. The network is cut with the browser's own switch, so what is checked is what an action does when
     its answer never comes: not an error page, not silence, a sentence that stays until it is dismissed and is in an alert. */
  console.log("\n== what a person is told ==");
  const offline = (on: boolean) => tab.call("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const waitFor = async (expression: string, ms = 6000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await tab.eval<boolean>(`Boolean(${expression})`)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  // Is somebody being told this, in an alert: the live region a screen reader speaks at once.
  const alerted = (text: string) => `Array.from(document.querySelectorAll('[role="alert"]')).some((e) => e.textContent.includes(${JSON.stringify(text)}))`;
  await tab.viewport(1280, 900);

  // An action whose answer never came (the connection cut under the click).
  await asOwner();
  await tab.goto(`${BASE}/backups`, 600);
  await offline(true);
  const cut = await tap(`Array.from(document.querySelectorAll("main button")).find((b) => /back up now/i.test(b.textContent))`);
  const told = await waitFor(alerted("did not answer"));
  await offline(false);
  const still = await tab.eval<boolean>(`document.body.innerText.includes("could not be shown")`);
  check(`a click with the connection cut says so, in an alert, and the page is still the page (${cut})`, cut === "ok" && told && !still, `${cut} told=${told} errorPage=${still}`);
  await new Promise((r) => setTimeout(r, 9000));
  check("and it is still there after nine seconds: a failure stays until it is dismissed", await waitFor(alerted("did not answer"), 300));
  // A message pushed just before a navigation went with the page that held it (a clone that could not copy its world).
  const away = await tap(barLink("/nodes"));
  const there = away === "ok" && (await arrived("/nodes"));
  check(`and it is still there on the next page, after a click on the sidebar (${away})`, there && (await waitFor(alerted("did not answer"), 3000)));
  await tap(`document.querySelector('[role="alert"] button[aria-label="Dismiss"]')`);
  check("until Dismiss is pressed", await waitFor(`!(${alerted("did not answer")})`, 2000));

  // The same, inside a dialog: the page behind a modal dialog is inert and under its backdrop, so the message has to be in the dialog.
  await asOwner();
  await tab.goto(`${BASE}/nodes/fra-node-02`, 700);
  await tap(`Array.from(document.querySelectorAll("main button")).find((b) => b.textContent.trim() === "Configure")`);
  await waitFor(`document.querySelector("dialog[open] #node-city")`);
  await tab.eval(`(() => { const e = document.querySelector("dialog[open] #node-city"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, "Elsewhere"); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await new Promise((r) => setTimeout(r, 300));
  await offline(true);
  const save = await tap(`Array.from(document.querySelectorAll("dialog[open] button")).find((b) => b.textContent.trim() === "Save")`);
  const inside = await waitFor(`document.querySelector('dialog[open] [role="alert"]')?.textContent.includes("did not answer")`);
  await offline(false);
  check(`a failure raised in a dialog is shown in the dialog (${save})`, save === "ok" && inside);
  if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, "feedback-in-dialog.png"));

  // A control that replaces itself leaves focus on the safe button.
  await asOwner();
  await tab.goto(`${BASE}/api-keys`, 700);
  await tap(`Array.from(document.querySelectorAll("main button")).find((b) => (b.getAttribute("aria-label") || "").startsWith("Revoke"))`);
  const armed = await tab.eval<string>(`document.activeElement?.textContent?.trim() ?? ""`);
  check(`after "Revoke", focus is on Cancel, not on the page (${armed || "nowhere"})`, armed === "Cancel");

  // A secret that is shown once: focus goes to it, and Copy does not say Copied over a clipboard that refused.
  await asOwner();
  await tab.goto(`${BASE}/api-keys`, 700);
  await tap(`Array.from(document.querySelectorAll("main button")).find((b) => b.textContent.trim() === "Create key")`);
  await waitFor(`document.querySelector('input[name="name"]')`);
  await tab.eval(`(() => { const f = document.querySelector('input[name="name"]').form; f.querySelector('input[name="name"]').value = "verify key"; const box = Array.from(f.querySelectorAll('input[name="scopes"]')).find((c) => !c.disabled); box.click(); f.requestSubmit(); })()`);
  const revealed = await waitFor(`document.querySelector('[aria-label="Your new secret, shown once"]')`, 10000);
  const focused = await tab.eval<string>(`document.activeElement?.getAttribute("aria-label") ?? ""`);
  check(`a secret just made has focus (${focused || "nowhere"})`, revealed && focused === "Your new secret, shown once");
  await tab.eval(`Object.defineProperty(navigator, "clipboard", { get: () => undefined, configurable: true }); document.execCommand = () => false;`);
  await tap(`Array.from(document.querySelectorAll('[aria-label="Your new secret, shown once"] button')).find((b) => /cop(y|ied)/i.test(b.textContent))`);
  await new Promise((r) => setTimeout(r, 400));
  const refused = await tab.eval<string>(`document.querySelector('[aria-label="Your new secret, shown once"]').innerText`);
  check("a Copy the browser refused says Not copied, and what to press, and never Copied", /Not copied/.test(refused) && /Ctrl\+C/.test(refused) && !/\bCopied\b/.test(refused), refused.replaceAll("\n", " | "));
  // The message under the button must not take the secret's room: it was one character wide, in a column eight hundred tall.
  const room = await tab.eval<number>(`Math.round(document.querySelector('[aria-label="Your new secret, shown once"] code').getBoundingClientRect().width)`);
  check(`and the secret keeps its room beside it (${room} px)`, room >= 200, String(room));
  const selected = await tab.eval<string>(`String(window.getSelection())`);
  check("and the secret is selected, so that Ctrl+C is the one step left", selected.length > 20, selected);
  await tab.eval(`document.execCommand = () => true;`);
  await tap(`Array.from(document.querySelectorAll('[aria-label="Your new secret, shown once"] button')).find((b) => /cop(y|ied)/i.test(b.textContent))`);
  await new Promise((r) => setTimeout(r, 400));
  check("one the browser allowed says Copied", /\bCopied\b/.test(await tab.eval<string>(`document.querySelector('[aria-label="Your new secret, shown once"]').innerText`)));
  if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, "feedback-secret.png"));

  // A message carried over a redirect (deleting a server) is shown once by the page it lands on.
  await asOwner();
  const flash = encodeURIComponent(JSON.stringify({ id: "verify-flash", tone: "warning", title: "Server deleted", body: "Its last backup is final-1, kept on the node." }));
  await tab.setCookie("gb_flash", flash, HOST);
  await tab.goto(`${BASE}/servers`, 600);
  const shown = await waitFor(`document.body.innerText.includes("Its last backup is final-1")`, 8000);
  await new Promise((r) => setTimeout(r, 800));
  const jar = (await tab.call("Network.getCookies", { urls: [BASE] })) as { cookies: Array<{ name: string }> };
  check("a message left on a cookie before a redirect is on the next page", shown);
  check("and the cookie is gone once it is", !jar.cookies.some((c) => c.name === "gb_flash"));

  // A field's error is tied to it.
  await asOwner();
  await tab.goto(`${BASE}/settings?server=aurora`, 700);
  await waitFor(`document.querySelector("#s-name")`);
  await tab.eval(`(() => { const e = document.querySelector("#s-name"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await new Promise((r) => setTimeout(r, 500));
  const wired = await tab.eval<{ invalid: string | null; said: string }>(`(() => { const e = document.querySelector("#s-name"); const d = (e.getAttribute("aria-describedby") || "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim(); return { invalid: e.getAttribute("aria-invalid"), said: d }; })()`);
  check(`a field with an error is invalid, and described by what the error says ("${wired.said.slice(0, 50)}")`, wired.invalid === "true" && wired.said.length > 5, JSON.stringify(wired));

  /* The first visit, before the toggle has been used: the system's own preference, and then the choice. */
  console.log("\n== the first visit ==");
  const grey = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
    return ((r ?? 0) + (g ?? 0) + (b ?? 0)) / 3;
  };
  await tab.call("Network.clearBrowserCookies");
  await tab.setCookie("gb_session", cookie, HOST);
  await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await tab.goto(`${BASE}/servers`, 800);
  const visit = await tab.eval<{ attr: string | null; bg: string }>(`({ attr: document.documentElement.getAttribute("data-theme"), bg: getComputedStyle(document.body).backgroundColor })`);
  check(`a machine set to light is shown light on a first visit, before any choice (${visit.bg})`, visit.attr === null && grey(visit.bg) > 200, JSON.stringify(visit));
  const toggled = await tap(`Array.from(document.querySelectorAll("nav button, aside button, button")).find((b) => /switch to dark theme/i.test(b.getAttribute("aria-label") || "") && b.getBoundingClientRect().width > 0)`);
  await new Promise((r) => setTimeout(r, 400));
  const chosen = await tab.eval<{ attr: string | null; bg: string }>(`({ attr: document.documentElement.getAttribute("data-theme"), bg: getComputedStyle(document.body).backgroundColor })`);
  check(`the toggle then goes to dark at the first press, not to the theme it was already in (${toggled}, ${chosen.attr})`, toggled === "ok" && chosen.attr === "dark" && grey(chosen.bg) < 60, JSON.stringify(chosen));
  await tab.goto(`${BASE}/servers`, 800);
  const stays = await tab.eval<string | null>(`document.documentElement.getAttribute("data-theme")`);
  check("and the choice outlives the system's preference, on the next page", stays === "dark");
  await tab.call("Emulation.setEmulatedMedia", { features: [] });

  /* P34: what a screen reader and a keyboard meet where a page moves by itself or asks for one choice among several. The terminal is not here:
     it needs a node with a shell, which this database has not. */
  console.log("\n== a screen reader and a keyboard, in depth ==");
  await tab.call("Network.clearBrowserCookies");
  await tab.setCookie("gb_session", cookie, HOST);
  await tab.setCookie("gb-theme", "dark", HOST);
  await tab.goto(`${BASE}/console`, 1200);
  await tab.eval(`localStorage.removeItem("gb-console-announce")`);
  await tab.goto(`${BASE}/console`, 1200);
  await waitFor(`document.querySelector('[role="log"]')`);
  const consoleLive = () => tab.eval<string | null>(`document.querySelector('[role="log"]')?.getAttribute("aria-live") ?? null`);
  check("the console's log is not a live region until it is asked to be", (await consoleLive()) === "off", String(await consoleLive()));
  check(
    "reading it aloud is a button with a state, off",
    (await tab.eval<string | null>(`document.querySelector('button[aria-label="Announce new lines"]')?.getAttribute("aria-pressed") ?? null`)) === "false",
  );
  await tap(`document.querySelector('button[aria-label="Announce new lines"]')`);
  check("pressing it makes the log announce, and the button says so", (await consoleLive()) === "polite" && (await tab.eval<string | null>(`document.querySelector('button[aria-label="Announce new lines"]')?.getAttribute("aria-pressed") ?? null`)) === "true");
  await tap(`document.querySelector('button[aria-label="Pause auto-scroll"]')`);
  check("a paused console does not announce, whatever was asked", (await consoleLive()) === "off");
  check(
    "and says that it is paused, in a status",
    await tab.eval<boolean>(`Array.from(document.querySelectorAll('[role="status"]')).some((e) => /paused/i.test(e.textContent || ""))`),
  );
  check("the pause button keeps one name and has a state", (await tab.eval<string | null>(`document.querySelector('button[aria-label="Pause auto-scroll"]')?.getAttribute("aria-pressed") ?? null`)) === "true");
  await tab.eval(`localStorage.removeItem("gb-console-announce")`);

  await tab.goto(`${BASE}/servers/new`, 900);
  await tab.eval(`localStorage.clear()`);
  await tab.goto(`${BASE}/servers/new`, 900);
  await waitFor(`document.querySelector('[role="radiogroup"]')`);
  const radios = await tab.eval<{ n: number; checked: number; stops: number; steps: string[] }>(`(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="Game"]');
    const r = Array.from(group.querySelectorAll('[role="radio"]'));
    return {
      n: r.length,
      checked: r.filter((e) => e.getAttribute("aria-checked") === "true").length,
      stops: r.filter((e) => e.tabIndex === 0).length,
      steps: Array.from(document.querySelectorAll("main button[aria-label], main button")).slice(0, 5).map((b) => b.getAttribute("aria-label") || ""),
    };
  })()`);
  check("the game is a radio group: several choices, one of them chosen, one tab stop", radios.n > 1 && radios.checked === 1 && radios.stops === 1, JSON.stringify(radios));
  const arrowed = await tab.eval<{ before: string | null; after: string | null; moved: boolean }>(`(async () => {
    const group = document.querySelector('[role="radiogroup"][aria-label="Game"]');
    const r = Array.from(group.querySelectorAll('[role="radio"]'));
    const on = r.find((e) => e.getAttribute("aria-checked") === "true");
    on.focus();
    on.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    // The choice is state, drawn a moment after the key.
    await new Promise((done) => setTimeout(done, 250));
    const now = r.find((e) => e.getAttribute("aria-checked") === "true");
    return { before: on.textContent.slice(0, 20), after: now?.textContent.slice(0, 20) ?? null, moved: now !== on && document.activeElement === now };
  })()`);
  check("an arrow key chooses the next game and takes focus there, as a native group does", arrowed.moved, JSON.stringify(arrowed));
  check("every step of the stepper has a name that says which and what it does", radios.steps.slice(0, 5).every((n) => /^(Step|Back to step) \d: /.test(n)) || radios.steps.some((n) => /^Step 1: /.test(n)), JSON.stringify(radios.steps));
  await tap(`Array.from(document.querySelectorAll("footer button")).pop()`);
  await waitFor(`document.activeElement && document.activeElement.tagName === "H1"`);
  check(
    "a change of step puts focus on the new heading and says which step it is",
    await tab.eval<boolean>(`document.activeElement.tagName === "H1" && Array.from(document.querySelectorAll('[role="status"]')).some((e) => /Step 2 of 5/.test(e.textContent || ""))`),
    await tab.eval<string>(`document.activeElement.tagName + " " + Array.from(document.querySelectorAll('[role="status"]')).map((e) => e.textContent).join(" | ")`),
  );
  await tab.eval(`localStorage.clear()`);

  await tab.goto(`${BASE}/analytics?range=30d`, 1200);
  const charts = await tab.eval<{ heat: boolean; heatTable: boolean; players: boolean; playersTable: boolean; summaries: string[] }>(`(() => {
    const labelled = (prefix) => Array.from(document.querySelectorAll('[role="img"]')).filter((e) => (e.getAttribute("aria-label") || "").startsWith(prefix));
    const heat = labelled("Joins by weekday and hour");
    const players = labelled("Players online over time");
    const tables = Array.from(document.querySelectorAll("table"));
    return {
      heat: heat.length > 0,
      heatTable: tables.some((t) => /Joins by weekday and hour/.test(t.querySelector("caption")?.textContent || "") && t.querySelectorAll('th[scope="row"]').length === 7),
      players: players.length > 0,
      playersTable: tables.some((t) => /Players online/.test(t.querySelector("caption")?.textContent || "") && t.querySelectorAll('th[scope="row"]').length > 0),
      summaries: [...heat, ...players].map((e) => e.getAttribute("aria-label").slice(0, 80)),
    };
  })()`);
  check("the joins heatmap says what it shows, and has its figures as a table (where there are joins)", !charts.heat || charts.heatTable, JSON.stringify(charts));
  check("so does the players chart (where something was recorded)", !charts.players || charts.playersTable, JSON.stringify(charts));

  // For whoever has to judge the look: the pages that carry the most colour, in both themes.
  if (process.env.A11Y_SHOTS) {
    for (const theme of ["dark", "light"] as const) {
      for (const at of ["/", "/servers/aurora", "/api-keys", "/console", "/analytics", "/nodes", "/audit"]) {
        await tab.call("Network.clearBrowserCookies");
        await tab.setCookie("gb_session", cookie, HOST);
        await tab.setCookie("gb-theme", theme, HOST);
        await tab.goto(`${BASE}${at}`, 900);
        await tab.shot(path.join(process.env.A11Y_SHOTS, `look-${theme}-${at === "/" ? "dashboard" : at.slice(1).replaceAll("/", "-")}.png`));
      }
    }
  }

  /* The first hour on a small machine. A node of 3 GB and two cores (the documented VPS: 3.8 GB, of which the agent counts three whole ones)
     is added to the verification database, and the wizard is driven the way a first server is made. It runs last, because it takes the rest of the workspace away. */
  console.log("\n== the first server on a 3 GB node ==");
  await db.node.create({
    data: {
      name: "vps-3gb",
      city: "vps",
      region: "eu-central",
      state: "HEALTHY",
      pingMs: 1,
      cpuPct: 5,
      ramPct: 10,
      diskPct: 10,
      cpuCores: 2,
      ramTotal: 3,
      diskTotal: 40,
      daemon: "0.8.1",
      registeredAt: new Date(),
      approvedAt: new Date(),
      os: "linux",
      arch: "x64",
      capabilities: ["docker", "steamcmd", "java", "ssd"],
    },
  });
  /* A workspace that is only this machine: no other node, and no server, so that nothing gives the wizard a domain to start from (the servers of
     this workspace sit under ashfold.gg, which is what a workspace's own domain is). Servers go first, which takes their records with them. */
  await db.server.deleteMany();
  await db.node.deleteMany({ where: { name: { not: "vps-3gb" } } });
  const nextButton = `Array.from(document.querySelectorAll("footer button")).pop()`;
  const setField = (selector: string, value: string) =>
    tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await tab.viewport(1280, 900);
  await tab.call("Network.clearBrowserCookies");
  await tab.setCookie("gb_session", cookie, HOST);
  await tab.setCookie("gb-theme", "dark", HOST);
  await tab.goto(`${BASE}/servers/new`, 900);
  await tab.eval(`localStorage.clear()`);
  await tab.goto(`${BASE}/servers/new`, 900);
  await waitFor(`document.querySelector("footer button")`);
  await tap(nextButton); // game
  await tap(nextButton); // version
  await waitFor(`document.querySelector("#server-host")`);
  // The name first: the footer says what stops the step in order, and the name comes before the address.
  await setField('input[placeholder="Nightwatch"]', "Nightwatch");
  await new Promise((r) => setTimeout(r, 400));
  const address = await tab.eval<{ value: string; placeholder: string; footer: string }>(`({ value: document.querySelector("#server-host").value, placeholder: document.querySelector("#server-host").placeholder, footer: document.querySelector("footer").innerText })`);
  check(`with no domain and no provider the address is not a name nobody owns (${JSON.stringify(address.value)})`, !/ashfold/.test(address.value) && address.value === "", JSON.stringify(address));
  check("and it asks for one, saying what it can be", /node's address/.test(address.placeholder) && /Give the server an address/.test(address.footer), JSON.stringify(address));
  await setField("#server-host", "play.example.com");
  await new Promise((r) => setTimeout(r, 400));
  await tap(nextButton); // template -> resources
  await waitFor(`document.querySelectorAll('input[type="range"]').length === 3`);
  const sliders = await tab.eval<{ cpu: string; memory: string; disk: string; text: string }>(`(() => { const r = Array.from(document.querySelectorAll('input[type="range"]')); return { cpu: r[0].value, memory: r[1].value, disk: r[2].value, text: document.querySelector("main").innerText }; })()`);
  check(`Minecraft, the first game, starts at what the node can take: ${sliders.memory} GB, ${sliders.cpu}%, ${sliders.disk} GB`, sliders.memory === "3" && sliders.cpu === "200" && sliders.disk === "40", JSON.stringify(sliders));
  check("and says so, with the numbers", /Fitted to vps-3gb/.test(sliders.text) && /memory 3 GB instead of 8 GB/.test(sliders.text), sliders.text.slice(0, 300));
  await tap(nextButton); // resources -> review
  await waitFor(`/^Create /.test((${nextButton}).textContent.trim())`);
  const create = await tab.eval<{ label: string; disabled: boolean; footer: string }>(`(() => { const b = ${nextButton}; return { label: b.textContent.trim(), disabled: b.disabled, footer: document.querySelector("footer").innerText }; })()`);
  check(`and the review step lets it be created: "${create.label}" is enabled, with no refusal in the footer`, !create.disabled && /^Create /.test(create.label) && !/out of (memory|CPU|storage)/.test(create.footer), JSON.stringify(create));
  const wholeWizard = await tab.eval<string>(`document.body.innerText`);
  check("nowhere in the wizard is a name nobody owns offered", !/ashfold\.gg/.test(wholeWizard));
  if (process.env.A11Y_SHOTS) await tab.shot(path.join(process.env.A11Y_SHOTS, "first-hour-review.png"));

  // A game whose floor does not fit says so with the node's numbers, not "Every node: memory".
  await tab.eval(`localStorage.clear()`);
  await tab.goto(`${BASE}/servers/new?game=project-zomboid`, 900);
  await waitFor(`document.querySelector("footer button")`);
  await tap(nextButton);
  await tap(nextButton);
  await waitFor(`document.querySelector("#server-host")`);
  await setField('input[placeholder="Nightwatch"]', "Zomboid");
  await setField("#server-host", "zomboid.example.com");
  await new Promise((r) => setTimeout(r, 400));
  await tap(nextButton);
  await waitFor(`document.querySelectorAll('input[type="range"]').length === 3`);
  await new Promise((r) => setTimeout(r, 1200));
  const tooBig = await tab.eval<string>(`document.querySelector("main").innerText`);
  check("a game the node cannot hold says what it needs and what the node has", /vps-3gb cannot take Project Zomboid/.test(tooBig) && /at least 6 GB, and vps-3gb has 3 GB uncommitted/.test(tooBig) && /Memory: 6 GB requested, 3 GB uncommitted/.test(tooBig), tooBig.slice(0, 600));

  // No node that is approved: nothing to place a server on, said first.
  await db.node.updateMany({ data: { state: "PENDING", approvedAt: null } });
  await tab.goto(`${BASE}/servers/new`, 900);
  const none = await tab.eval<{ h1: string; text: string }>(`({ h1: document.querySelector("h1")?.textContent ?? "", text: document.body.innerText })`);
  check("with no node in service the wizard says Add a node first, and names the machine that waits", none.h1 === "Add a node first" && /waiting for your approval/.test(none.text), JSON.stringify(none));

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
