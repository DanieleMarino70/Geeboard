import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkshopDescription, type Block } from "../src/domain/games/bbcode.ts";

/* A Workshop description is shown in the Mods tab's dialog as blocks of text. These are the shapes Zomboid's own Workshop
   writes (Mod Options' page, below, is the first one the dialog was read against), and the ones an author could write to
   get something the panel did not plan for. */

const textOf = (block: Block): string =>
  block.kind === "list" ? block.items.map((i) => i.map((s) => s.text).join("")).join(" | ") : block.kind === "code" ? block.text : block.kind === "rule" ? "—" : block.spans.map((s) => s.text).join("");

test("headings, paragraphs, a link and a code block, as Mod Options writes them", () => {
  const blocks = parseWorkshopDescription(
    "ModOptions WIP (paused)!\n\nAllows other mods to be customized.\nAny mod author can add options.\n\n[h1]Requirements[/h1]\n(!) For Build 42 see [url=https://steamcommunity.com/sharedfiles/filedetails/?id=3386860561]here[/url].\n\n[h1]Minimal Code[/h1]\n[code]\n-- These are the defaults.\nlocal x = 1\n[/code]",
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["paragraph", "paragraph", "heading", "paragraph", "heading", "code"],
  );
  assert.equal(textOf(blocks[1]!), "Allows other mods to be customized.\nAny mod author can add options.");
  const link = (blocks[3] as Extract<Block, { kind: "paragraph" }>).spans.find((s) => s.href);
  assert.equal(link?.text, "here");
  assert.equal(link?.href, "https://steamcommunity.com/sharedfiles/filedetails/?id=3386860561");
  assert.equal(textOf(blocks[5]!), "-- These are the defaults.\nlocal x = 1");
});

test("lists, ordered and not, and bold inside them", () => {
  const blocks = parseWorkshopDescription("[list][*]one [b]two[/b][*]three[/list][olist][*]first[*]second[/olist]");
  assert.equal(blocks.length, 2);
  const [plain, ordered] = blocks as Array<Extract<Block, { kind: "list" }>>;
  assert.equal(plain!.ordered, false);
  assert.equal(textOf(plain!), "one two | three");
  assert.equal(plain!.items[0]!.find((s) => s.text === "two")?.bold, true);
  assert.equal(ordered!.ordered, true);
  assert.equal(textOf(ordered!), "first | second");
});

test("a link is a link only when it is http or https, and a bare [url] links its own text", () => {
  const blocks = parseWorkshopDescription(
    "[url=javascript:alert(1)]x[/url] [url=data:text/html,hi]y[/url] [url]https://example.com/a[/url] [url=\"https://example.com/q\"]q[/url]",
  );
  const spans = (blocks[0] as Extract<Block, { kind: "paragraph" }>).spans;
  assert.equal(spans.find((s) => s.text === "x")?.href, undefined);
  assert.equal(spans.find((s) => s.text === "y")?.href, undefined);
  assert.equal(spans.find((s) => s.text === "https://example.com/a")?.href, "https://example.com/a");
  assert.equal(spans.find((s) => s.text === "q")?.href, "https://example.com/q");
});

test("an image is left out with what it pointed at, and markup the panel does not know leaves its words", () => {
  const blocks = parseWorkshopDescription("before [img]https://tracker.example/pixel.png[/img] after [spoiler]hidden words[/spoiler] [table][tr][td]cell[/td][/tr][/table]");
  const text = blocks.map(textOf).join(" ");
  assert.ok(!text.includes("tracker.example"), text);
  assert.ok(text.includes("before") && text.includes("after") && text.includes("hidden words") && text.includes("cell"), text);
});

test("HTML in a description is text, never markup", () => {
  const blocks = parseWorkshopDescription("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.equal(blocks.length, 1);
  assert.equal(textOf(blocks[0]!), "<script>alert(1)</script> <img src=x onerror=alert(1)>");
});

test("unclosed tags and a huge description end, and stay bounded", () => {
  assert.doesNotThrow(() => parseWorkshopDescription("[b][i][list][*]never closed [url=https://x.y"));
  const many = parseWorkshopDescription("para\n\n".repeat(5_000));
  assert.ok(many.length <= 400, String(many.length));
  assert.deepEqual(parseWorkshopDescription(""), []);
});

test("[noparse] keeps its brackets as text", () => {
  const blocks = parseWorkshopDescription("[noparse][b]not bold[/b][/noparse]");
  assert.equal(textOf(blocks[0]!), "[b]not bold[/b]");
  assert.equal((blocks[0] as Extract<Block, { kind: "paragraph" }>).spans.some((s) => s.bold), false);
});
