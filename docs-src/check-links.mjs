// Walks the built site and fails on anything a reader would meet as a 404.
//
//   node docs-src/build.mjs && node docs-src/check-links.mjs
//
// web/scripts/verify-*.mts is the precedent: a script that proves one thing,
// by doing it, and says what it found. This one proves four.
//
//   1. Every link between pages lands on a file that exists.
//   2. Every fragment lands on an id that exists on that page.
//   3. Every address the Jekyll site served still answers — `reference.html`
//      and its twenty siblings, which are linked from outside this repository
//      and cannot be allowed to move.
//   4. Every code block on the site is character for character the code block
//      in the Markdown. The highlighter rewrites those lines, and a
//      highlighter that eats a backslash publishes a command that fails.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const docsDir = join(repo, 'docs');

const outArg = process.argv.indexOf('--site');
const siteDir = outArg === -1 ? join(repo, 'site') : resolve(process.argv[outArg + 1]);

const failures = [];

function fail(where, message) {
  failures.push(`${where}: ${message}`);
}

const htmlFiles = (await readdir(siteDir)).filter(name => name.endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error(`No pages in ${siteDir}. Run docs-src/build.mjs first.`);
  process.exit(1);
}

const pages = new Map();
for (const name of htmlFiles) {
  const html = await readFile(join(siteDir, name), 'utf8');
  pages.set(name, { html, ids: new Set(idsIn(html)) });
}

/* 1 and 2 — every link, and every fragment. */

let linkCount = 0;
for (const [name, page] of pages) {
  for (const href of hrefsIn(page.html)) {
    if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith('//')) continue;
    if (href.startsWith('data:')) continue;
    linkCount += 1;

    const [path, fragment] = splitFragment(href);

    if (path.endsWith('.md')) {
      fail(name, `links to ${href}, which is a Markdown file and not a page of the site`);
      continue;
    }

    const targetName = path === '' ? name : path;
    if (path !== '' && !pages.has(path)) {
      // Not a page: it has to be a file that was copied into the site.
      if (!existsSync(join(siteDir, path))) {
        fail(name, `links to ${href}, which is not in the built site`);
      }
      continue;
    }

    if (fragment) {
      const target = pages.get(targetName);
      if (!target) {
        fail(name, `links to ${href}, whose page is not in the built site`);
      } else if (!target.ids.has(decodeURIComponent(fragment))) {
        fail(name, `links to ${href}, and ${targetName} has no #${fragment}`);
      }
    }
  }

  for (const src of assetsIn(page.html)) {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
    if (!existsSync(join(siteDir, src))) {
      fail(name, `asks for ${src}, which is not in the built site`);
    }
  }
}

/* 3 — the addresses the old site served. */

const markdownFiles = (await readdir(docsDir)).filter(name => name.endsWith('.md'));
const oldAddresses = ['index.html', ...markdownFiles.map(name => name.replace(/\.md$/, '.html'))];
for (const address of oldAddresses) {
  if (!pages.has(address)) {
    fail('addresses', `/${address} was served by the old site and is not in the new one`);
  }
}

/* 4 — the code blocks are the code blocks. */

let blockCount = 0;
for (const name of markdownFiles) {
  const page = pages.get(name.replace(/\.md$/, '.html'));
  if (!page) continue;

  const source = await readFile(join(docsDir, name), 'utf8');
  const fromMarkdown = fencedBlocks(source);
  const fromHtml = codeBlocks(page.html);

  if (fromMarkdown.length !== fromHtml.length) {
    fail(
      name,
      `has ${fromMarkdown.length} code blocks and the page has ${fromHtml.length}`
    );
    continue;
  }

  for (let i = 0; i < fromMarkdown.length; i += 1) {
    blockCount += 1;
    if (fromMarkdown[i] !== fromHtml[i]) {
      fail(
        name,
        `code block ${i + 1} is not what the page shows:\n    markdown: ${JSON.stringify(fromMarkdown[i].slice(0, 90))}\n    page:     ${JSON.stringify(fromHtml[i].slice(0, 90))}`
      );
    }
  }
}

/* ── What it found ───────────────────────────────────────────────────── */

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  console.error(`\n${failures.length} problems in ${pages.size} pages.`);
  process.exit(1);
}

console.log(
  `${pages.size} pages · ${linkCount} internal links · ${blockCount} code blocks · no dead ends`
);

/* ── Reading the HTML ────────────────────────────────────────────────── */

function* idsIn(html) {
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) yield match[1];
}

function* hrefsIn(html) {
  for (const match of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) yield match[1];
}

function* assetsIn(html) {
  for (const match of html.matchAll(/<(?:script|img)\b[^>]*?\ssrc="([^"]*)"/g)) yield match[1];
  for (const match of html.matchAll(/<link\b[^>]*?\shref="([^"]*)"/g)) yield match[1];
}

function splitFragment(href) {
  const hash = href.indexOf('#');
  if (hash === -1) return [href, ''];
  return [href.slice(0, hash), href.slice(hash + 1)];
}

// The fenced blocks of a Markdown file, in order, without their fences. The
// front matter is skipped the same way the build skips it.
function fencedBlocks(source) {
  const lines = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split(/\r?\n/);
  const blocks = [];
  let open = null;
  let indent = 0;

  for (const line of lines) {
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fence && open === null) {
      open = [];
      indent = fence[1].length;
      continue;
    }
    if (fence && open !== null && fence[3].trim() === '') {
      blocks.push(open.join('\n'));
      open = null;
      continue;
    }
    if (open !== null) open.push(line.slice(indent));
  }

  return blocks;
}

function codeBlocks(html) {
  const blocks = [];
  for (const match of html.matchAll(/<figure class="code">[\s\S]*?<pre><code>([\s\S]*?)<\/code><\/pre>/g)) {
    blocks.push(unescapeHtml(match[1].replace(/<\/?span[^>]*>/g, '')));
  }
  return blocks;
}

function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
