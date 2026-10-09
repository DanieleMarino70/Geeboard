/* A Workshop description, read for the page that shows a mod.

   Steam writes descriptions in BBCode: headings, lists, links, quotes, and a
   great deal of decoration. The panel shows them inside its own page, so the
   markup is read into a few kinds of block and rendered as React text — never
   as HTML. Nothing an author writes becomes an element the panel did not plan
   for, a link is a link only when it is http or https, and an image is left out
   (fetching it would tell an address nobody chose that this panel's user is
   looking). A description that is not BBCode at all is a paragraph per blank
   line, which is what it was. */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  href?: string;
}

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; spans: Span[] }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

/** Longer than any description Steam keeps (8 000 characters), with room for its markup. */
const MAX_INPUT = 40_000;
const MAX_BLOCKS = 400;

const TAG = /\[(\/?)([a-z0-9*]{1,20})(?:=([^\]\n]{0,500}))?\]/gi;

function safeHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim().replace(/^["']|["']$/g, "");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseWorkshopDescription(input: string): Block[] {
  const source = input.slice(0, MAX_INPUT).replace(/\r\n?/g, "\n");
  const blocks: Block[] = [];
  let spans: Span[] = [];
  const style: { bold: number; italic: number; underline: number; strike: number; href: string | null } = {
    bold: 0,
    italic: 0,
    underline: 0,
    strike: 0,
    href: null,
  };
  let heading: 1 | 2 | 3 | null = null;
  let quote = 0;
  let list: { ordered: boolean; items: Span[][] } | null = null;
  // The text of a [url] with no address, which is its own address.
  let bareUrl: { at: number } | null = null;

  const push = (block: Block) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(block);
  };

  const trimmed = (list: Span[]): Span[] => {
    const out = list.filter((s) => s.text.length > 0);
    if (out.length === 0) return out;
    out[0] = { ...out[0]!, text: out[0]!.text.replace(/^\s+/, "") };
    const last = out.length - 1;
    out[last] = { ...out[last]!, text: out[last]!.text.replace(/\s+$/, "") };
    return out.filter((s) => s.text.length > 0);
  };

  /* Ends whatever the spans collected were part of: a list item, a heading, a quote, a paragraph. */
  const flush = () => {
    const done = trimmed(spans);
    spans = [];
    if (done.length === 0) return;
    if (list) {
      if (list.items.length === 0) list.items.push([]);
      list.items[list.items.length - 1]!.push(...done);
    } else if (heading) push({ kind: "heading", level: heading, spans: done });
    else if (quote > 0) push({ kind: "quote", spans: done });
    else push({ kind: "paragraph", spans: done });
  };

  const addText = (text: string) => {
    if (!text) return;
    const span: Span = { text };
    if (style.bold) span.bold = true;
    if (style.italic) span.italic = true;
    if (style.underline) span.underline = true;
    if (style.strike) span.strike = true;
    if (style.href) span.href = style.href;
    spans.push(span);
  };

  /* Text between tags. A blank line ends a paragraph; inside a list or a heading it is only a line break. */
  const text = (raw: string) => {
    if (list || heading) {
      addText(raw.replace(/\n{2,}/g, "\n"));
      return;
    }
    const parts = raw.split(/\n[ \t]*\n+/);
    parts.forEach((part, i) => {
      if (i > 0) flush();
      addText(part);
    });
  };

  /* Everything up to the closing tag, as it is: [code] and [noparse]. */
  const rawUntil = (from: number, name: string): { body: string; next: number } => {
    const close = source.toLowerCase().indexOf(`[/${name}]`, from);
    if (close < 0) return { body: source.slice(from), next: source.length };
    return { body: source.slice(from, close), next: close + name.length + 3 };
  };

  let at = 0;
  TAG.lastIndex = 0;
  while (at < source.length && blocks.length < MAX_BLOCKS) {
    TAG.lastIndex = at;
    const match = TAG.exec(source);
    if (!match) {
      text(source.slice(at));
      break;
    }
    text(source.slice(at, match.index));
    at = match.index + match[0].length;
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const value = match[3];

    switch (name) {
      case "b":
        style.bold += closing ? (style.bold > 0 ? -1 : 0) : 1;
        break;
      case "i":
        style.italic += closing ? (style.italic > 0 ? -1 : 0) : 1;
        break;
      case "u":
        style.underline += closing ? (style.underline > 0 ? -1 : 0) : 1;
        break;
      case "s":
      case "strike":
        style.strike += closing ? (style.strike > 0 ? -1 : 0) : 1;
        break;
      case "url":
        if (closing) {
          if (bareUrl) {
            const linked = spans.slice(bareUrl.at);
            const href = safeHref(linked.map((s) => s.text).join(""));
            if (href) for (const s of linked) s.href = href;
            bareUrl = null;
          }
          style.href = null;
        } else if (value !== undefined) {
          style.href = safeHref(value) ?? null;
        } else {
          bareUrl = { at: spans.length };
        }
        break;
      case "h1":
      case "h2":
      case "h3":
        flush();
        heading = closing ? null : (Number(name[1]) as 1 | 2 | 3);
        break;
      case "quote":
        flush();
        quote = closing ? Math.max(0, quote - 1) : quote + 1;
        break;
      case "list":
      case "olist":
        flush();
        if (closing) {
          if (list) {
            const items = list.items.filter((item) => item.length > 0);
            if (items.length > 0) push({ kind: "list", ordered: list.ordered, items });
          }
          list = null;
        } else if (!list) {
          list = { ordered: name === "olist", items: [] };
        }
        break;
      case "*":
        if (list) {
          flush();
          list.items.push([]);
        } else {
          flush();
        }
        break;
      case "hr":
        flush();
        push({ kind: "rule" });
        break;
      case "code":
      case "noparse": {
        if (closing) break;
        const { body, next } = rawUntil(at, name);
        at = next;
        if (name === "code") {
          flush();
          const kept = body.replace(/^\n+|\s+$/g, "");
          if (kept) push({ kind: "code", text: kept });
        } else {
          text(body);
        }
        break;
      }
      case "img": {
        // Left out, with what it pointed at: see the note at the top.
        if (closing) break;
        at = rawUntil(at, "img").next;
        break;
      }
      case "previewyoutube": {
        if (closing) break;
        at = rawUntil(at, "previewyoutube").next;
        break;
      }
      default:
        // spoiler, table, tr, td, th, and whatever Steam adds next: the markup goes, the words stay.
        break;
    }
  }
  flush();
  if (list) {
    const items = (list as { ordered: boolean; items: Span[][] }).items.filter((item) => item.length > 0);
    if (items.length > 0) push({ kind: "list", ordered: (list as { ordered: boolean }).ordered, items });
  }
  return blocks;
}
