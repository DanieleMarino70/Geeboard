// Markdown in, the site's HTML out.
//
// `marked` does the parsing — it is the one dependency here, it runs at build
// time only, nothing it produces reaches a visitor's browser, and a swap to
// `markdown-it` would touch this file and no other. Everything below it is
// ours, and it is all in service of four promises the README already makes:
//
//   * a heading's anchor is the same on the site as it is on github.com, so
//     `[installation.md#a-node](…)` lands in the same place in both;
//   * a link to `page.md` becomes a link to `page.html` and keeps its
//     fragment, so the Markdown stays the version GitHub reads;
//   * a code block carries its language and a copy button;
//   * a link that leaves the site says so.

import { Marked } from 'marked';
import { escapeHtml, highlight, languageLabel } from './highlight.mjs';

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// GitHub's rule, which kramdown followed closely enough that the anchors in
// docs/ already work in both places: lower case, drop everything that is not
// a letter, a number, a space, an underscore or a hyphen, then one hyphen per
// space. Per space, not per run of them: `Lines — what counts` loses its dash
// and keeps both spaces, so the anchor is `lines--what-counts`, with two.
// Collapsing them is how `versions.md#lines--what-counts-as-an-update` — a
// link that works on GitHub today — would have become a 404 on the site.
// A repeated heading gets `-1`, `-2`, counted per page, exactly as there.
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function createSlugger() {
  const seen = new Map();
  return text => {
    const base = slugify(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

// The text a heading reads as once its markup is gone: `**Docker**, and why`
// is `Docker, and why`, which is what the anchor and the search index use.
export function plainText(tokens = []) {
  return tokens
    .map(token => {
      if (token.type === 'text' || token.type === 'codespan' || token.type === 'escape') {
        return token.text;
      }
      if (token.type === 'html') return '';
      if (token.tokens) return plainText(token.tokens);
      return token.raw ?? '';
    })
    .join('');
}

// A link that stays inside the documentation, rewritten for the site. GitHub
// follows the file; the site follows the page; the fragment survives both.
export function rewriteHref(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    return { href, external: true };
  }
  if (href.startsWith('#')) return { href, external: false };

  const [path, fragment] = splitFragment(href);
  if (path.endsWith('.md')) {
    const page = `${path.slice(0, -3)}.html`;
    return { href: fragment ? `${page}#${fragment}` : page, external: false };
  }
  return { href, external: false };
}

function splitFragment(href) {
  const hash = href.indexOf('#');
  if (hash === -1) return [href, ''];
  return [href.slice(0, hash), href.slice(hash + 1)];
}

function copyButton() {
  return (
    '<button class="code-copy" type="button" data-copy>' +
    '<svg viewBox="0 0 16 16" aria-hidden="true" width="13" height="13">' +
    '<path fill="currentColor" d="M5 1.5A1.5 1.5 0 0 1 6.5 0h6A1.5 1.5 0 0 1 14 1.5v8a1.5 1.5 0 0 1-1.5 1.5H11v1.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3H5V1.5Zm1.5 0v1.5h3A1.5 1.5 0 0 1 11 4.5V9.5h1.5V1.5h-6Zm3 3h-6v8h6v-8Z"/>' +
    '</svg><span>Copy</span></button>'
  );
}

/**
 * Renders one Markdown file.
 *
 * Returns the body HTML, the page's own title (its first heading), the
 * paragraph under it, the headings the table of contents is built from, and
 * the plain text the search index is built from — all from one parse, so the
 * anchors in the three of them cannot drift apart.
 */
export function renderPage(source, options = {}) {
  const markdown = source.replace(FRONT_MATTER, '');
  const marked = new Marked({ gfm: true, breaks: false });
  const slug = createSlugger();

  const tokens = marked.lexer(markdown);

  // The slugs are assigned here, walking the tokens in document order, and
  // the renderer below reads them back off the same token objects. One pass
  // decides an anchor; nothing recomputes it and gets a different answer.
  const toc = [];
  let title = '';
  let titleSlug = '';
  let lede = '';
  walk(tokens, token => {
    if (token.type !== 'heading') return;
    const text = plainText(token.tokens);
    token.slug = slug(text);
    token.plain = text;
    if (token.depth === 1 && !title) {
      title = text;
      titleSlug = token.slug;
    }
    if (token.depth === 2 || token.depth === 3) {
      toc.push({ depth: token.depth, text, slug: token.slug });
    }
  });

  const firstParagraph = tokens.find(
    token => token.type === 'paragraph'
  );
  if (firstParagraph) lede = plainText(firstParagraph.tokens).replace(/\s+/g, ' ');

  // The home page shows its title and its opening paragraph in the hero, so
  // it asks for them to be left out of the body below it.
  const body = options.dropLede
    ? tokens.filter(token => token !== firstParagraph && !(token.type === 'heading' && token.depth === 1))
    : tokens;
  body.links = tokens.links;

  const links = [];
  const renderer = {
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      const anchor =
        token.depth === 1
          ? ''
          : `<a class="anchor" href="#${token.slug}" aria-label="Link to this section">#</a>`;
      return `<h${token.depth} id="${token.slug}">${inner}${anchor}</h${token.depth}>\n`;
    },

    link(token) {
      const { href, external } = rewriteHref(token.href);
      links.push({ href: token.href, resolved: href, external });
      const inner = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      if (external) {
        return `<a href="${escapeHtml(href)}"${title} class="external" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      }
      return `<a href="${escapeHtml(href)}"${title}>${inner}</a>`;
    },

    code(token) {
      const label = languageLabel(token.lang);
      const body = highlight(token.text, token.lang);
      const head =
        `<div class="code-head">` +
        `<span class="code-lang">${escapeHtml(label)}</span>` +
        copyButton() +
        `</div>`;
      return `<figure class="code">${head}<pre><code>${body}</code></pre></figure>\n`;
    },

    table(token) {
      const head = token.header
        .map((cell, index) => {
          const align = token.align[index] ? ` style="text-align:${token.align[index]}"` : '';
          return `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        })
        .join('');
      const body = token.rows
        .map(row => {
          const cells = row
            .map((cell, index) => {
              const align = token.align[index] ? ` style="text-align:${token.align[index]}"` : '';
              return `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('\n');
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>\n`;
    },

    blockquote(token) {
      return `<blockquote class="callout">${this.parser.parse(token.tokens)}</blockquote>\n`;
    }
  };

  marked.use({ renderer });
  const html = marked.parser(body);

  return { html, title, titleSlug, lede, toc, links, search: searchEntries(tokens) };
}

// Every token in the document, in reading order. The guards are `isArray`
// and not truthiness because a table cell carries `header: true`, which is a
// boolean and not a list of anything.
function walk(tokens, visit) {
  for (const token of tokens) {
    visit(token);
    if (Array.isArray(token.tokens)) walk(token.tokens, visit);
    if (Array.isArray(token.items)) walk(token.items, visit);
    if (Array.isArray(token.rows)) for (const row of token.rows) walk(row, visit);
    if (Array.isArray(token.header)) walk(token.header, visit);
  }
}

// One search entry per heading: what it is called, where it is, and the first
// stretch of prose under it. Code blocks and tables stay out — a search that
// matches a word inside a shell command sends the reader to the wrong place.
function searchEntries(tokens) {
  const entries = [];
  let current = null;

  for (const token of tokens) {
    if (token.type === 'heading') {
      current = { heading: token.plain ?? '', slug: token.slug, depth: token.depth, text: '' };
      entries.push(current);
      continue;
    }
    if (!current || current.text.length > 320) continue;
    if (token.type === 'paragraph') {
      current.text = `${current.text} ${plainText(token.tokens)}`.trim();
    }
    if (token.type === 'list') {
      current.text = `${current.text} ${plainText(token.items)}`.trim();
    }
  }

  return entries.map(entry => ({
    ...entry,
    text: entry.text.replace(/\s+/g, ' ').slice(0, 320)
  }));
}
