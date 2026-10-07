import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "../src/components/form";
import { LOST_CONTACT, lostContact } from "../src/components/use-action";
import { STAYS_MS } from "../src/components/toast";
import { FLASH_COOKIE, decodeFlash, encodeFlash } from "../src/domain/flash";

/* What a person is told when something goes wrong, and for how long: a message that is gone before it is read, a field whose error nothing
   points at, a Copy button that says "Copied" over nothing, and an action whose answer never came and replaced the page. The browser checks
   are in verify:a11y; these are the parts that do not need one. */

const SRC = path.join(import.meta.dirname, "..", "src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) files(file, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(file);
  }
  return out;
}

const field = (props: Record<string, unknown>, child: React.ReactNode) =>
  renderToStaticMarkup(createElement(Field, { label: "Server name", ...props } as never, child));

test("a field's error is tied to its control: described by it, and marked invalid", () => {
  const html = field({ htmlFor: "n", error: "Too short." }, createElement("input", { id: "n" }));
  assert.match(html, /<input[^>]*id="n"/);
  assert.match(html, /<input[^>]*aria-describedby="n-hint"/);
  assert.match(html, /<input[^>]*aria-invalid="true"/);
  assert.match(html, /<label[^>]*for="n"/);
  assert.match(html, /<span[^>]*id="n-hint"[^>]*role="alert"/);
});

test("a hint is described too, and nothing is invalid until there is an error", () => {
  const html = field({ htmlFor: "n", hint: "Shown in the panel." }, createElement("input", { id: "n" }));
  assert.match(html, /aria-describedby="n-hint"/);
  assert.doesNotMatch(html, /aria-invalid/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("a field without an id of its own is given one, the same on the label, the control and the message", () => {
  const html = field({ error: "Nope." }, createElement("select", null, createElement("option", null, "a")));
  const id = /<select[^>]*?\sid="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, html);
  assert.ok(html.includes(`for="${id}"`));
  assert.ok(html.includes(`aria-describedby="${id}-hint"`));
  assert.ok(html.includes(`id="${id}-hint"`));
});

test("the control is found inside a wrapper, and only the first one is wired", () => {
  const html = field(
    { htmlFor: "addr", error: "Bad." },
    createElement("div", { className: "flex" }, createElement("input", { id: "addr" }), createElement("button", { type: "button" }, "Paste")),
  );
  assert.match(html, /<input[^>]*aria-describedby="addr-hint"/);
  assert.doesNotMatch(html, /<button[^>]*aria-describedby/);
});

test("a form that checks as you type ties the error to the field without announcing it at every keystroke", () => {
  const html = field({ htmlFor: "n", error: "Too short.", quiet: true }, createElement("input", { id: "n" }));
  assert.match(html, /aria-describedby="n-hint"/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("an error says so in more than its colour", () => {
  const html = field({ htmlFor: "n", error: "Too short." }, createElement("input", { id: "n" }));
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
});

test("a failure stays until it is dismissed; the rest go by themselves, and a warning is given longer than a success", () => {
  assert.equal(STAYS_MS.danger, null);
  assert.ok(typeof STAYS_MS.success === "number" && STAYS_MS.success >= 8000);
  assert.ok(typeof STAYS_MS.warning === "number" && STAYS_MS.warning > STAYS_MS.success);
});

test("an action that never came back is a sentence, and Next's own redirects are not swallowed", () => {
  assert.equal(lostContact(new TypeError("Failed to fetch")), LOST_CONTACT);
  assert.match(LOST_CONTACT.body, /not known whether/);
  // What Next throws for redirect(): its digest names it, and the router, not a toast, is what acts on it.
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/servers;307;" });
  assert.throws(() => lostContact(redirect), (error) => error === redirect);
});

test("the message carried over a redirect is bounded, and anything that is not one is nothing", () => {
  const flash = decodeFlash(encodeFlash({ tone: "warning", title: "Deleted", body: "Its last backup is final-1." }, "abc"));
  assert.deepEqual(flash, { id: "abc", tone: "warning", title: "Deleted", body: "Its last backup is final-1." });
  const long = decodeFlash(encodeFlash({ tone: "success", title: "t".repeat(1000), body: "b".repeat(5000) }, "x"));
  assert.ok(long && long.title.length <= 160 && long.body.length <= 800);
  for (const junk of [undefined, "", "not json", encodeURIComponent("[]"), encodeURIComponent(JSON.stringify({ id: "x", tone: "loud", title: "a", body: "b" })), encodeURIComponent(JSON.stringify({ id: "", tone: "success", title: "a", body: "b" })), encodeURIComponent(JSON.stringify({ id: "x", tone: "success", title: 1, body: "b" }))]) {
    assert.equal(decodeFlash(junk), null, String(junk));
  }
  assert.equal(FLASH_COOKIE, "gb_flash");
});

test("a button that calls an action goes through useAction, so a failure to reach the panel is said", () => {
  const offenders: string[] = [];
  for (const file of files(SRC)) {
    if (file.endsWith(path.join("components", "use-action.ts"))) continue;
    if (/\buseTransition\b/.test(readFileSync(file, "utf8"))) offenders.push(path.relative(SRC, file));
  }
  assert.deepEqual(offenders, [], "use useAction() from @/components/use-action where useTransition() was");
});

test("nothing says Copied over a clipboard it did not ask: copying goes through use-copy", () => {
  const allowed = new Set([path.join("components", "use-copy.ts"), path.join("app", "terminal", "emulator.tsx")]);
  const offenders: string[] = [];
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file);
    if (allowed.has(rel)) continue;
    if (/navigator\.clipboard/.test(readFileSync(file, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "use copyText() / useCopy() from @/components/use-copy, which waits for the answer and tries the old way");
});

test("one toast provider, for the document: a message pushed just before a navigation is not destroyed with the page", () => {
  const holders = files(SRC)
    .filter((file) => !file.endsWith(path.join("components", "toast.tsx")))
    .filter((file) => /<ToastProvider[\s>]/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  assert.deepEqual(holders, [path.join("app", "layout.tsx")]);
});
