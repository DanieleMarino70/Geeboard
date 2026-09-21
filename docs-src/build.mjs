// Builds the documentation site out of docs/*.md.
//
//   node docs-src/build.mjs            → site/
//   node docs-src/build.mjs --out dir  → somewhere else
//
// One HTML file per Markdown file, named after it and flat at the root, which
// is not an aesthetic choice: the site Jekyll served answered on
// `…/Geeboard/reference.html`, those links are out in the world, and a page
// that moves to `…/reference/` breaks every one of them. check-links.mjs
// fails the build if a single one of those addresses stops answering.
//
// Nothing here writes into docs/. The Markdown is the source, it stays the
// version GitHub renders, and the site is a second reading of it.

import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from './markdown.mjs';
import { renderDocPage, renderHome } from './template.mjs';
import { home, order, sections } from './nav.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const docsDir = join(repo, 'docs');

const outArg = process.argv.indexOf('--out');
const outDir = outArg === -1 ? join(repo, 'site') : resolve(process.argv[outArg + 1]);

const version = JSON.parse(await readFile(join(repo, 'web', 'package.json'), 'utf8')).version;

async function main() {
  const markdownFiles = (await readdir(docsDir)).filter(name => name.endsWith('.md'));
  assertEveryPageIsPlaced(markdownFiles);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'assets', 'fonts'), { recursive: true });

  const searchIndex = [];

  // The home page. Its title and first paragraph become the hero, so they are
  // taken out of the body: the same words twice on one screen reads as a bug.
  const homeSource = await readFile(join(docsDir, home.file), 'utf8');
  const homePage = renderPage(homeSource, { dropLede: true });
  await writeFile(
    join(outDir, 'index.html'),
    renderHome({
      version,
      title: homePage.title,
      titleSlug: homePage.titleSlug,
      lede: homePage.lede,
      bodyHtml: homePage.html,
      primary: { label: 'Browse the documentation', href: 'production.html' },
      secondary: { label: 'Try it on a laptop', href: 'installation.html' }
    }),
    'utf8'
  );
  collect(searchIndex, homePage, { file: home.file, title: 'Home', section: 'Geeboard' });

  for (const [index, page] of order.entries()) {
    const source = await readFile(join(docsDir, page.file), 'utf8');
    const rendered = renderPage(source);
    const name = page.file.replace(/\.md$/, '.html');

    await writeFile(
      join(outDir, name),
      renderDocPage({
        file: page.file,
        title: rendered.title || page.title,
        description: rendered.lede.slice(0, 180),
        version,
        sectionTitle: page.section.title,
        bodyHtml: rendered.html,
        toc: rendered.toc,
        previous: order[index - 1],
        next: order[index + 1]
      }),
      'utf8'
    );
    collect(searchIndex, rendered, {
      file: page.file,
      title: rendered.title || page.title,
      section: page.section.title
    });
  }

  await copyAssets();
  await writeFile(
    join(outDir, 'assets', 'search.js'),
    `window.GEEBOARD_SEARCH = ${JSON.stringify(searchIndex)};\n`,
    'utf8'
  );

  // GitHub Pages runs Jekyll over whatever it is given unless this file is
  // there. It is the one line that keeps Liquid away from a page that
  // contains two curly braces in a code block.
  await writeFile(join(outDir, '.nojekyll'), '', 'utf8');

  const pages = order.length + 1;
  const entries = searchIndex.length;
  console.log(`${pages} pages · ${entries} search entries · ${outDir}`);
}

// A Markdown file that is in docs/ and in no section would be published with
// no way to reach it. That is the failure Jekyll used to hide behind a
// missing `nav_order`, so it stops the build here.
function assertEveryPageIsPlaced(markdownFiles) {
  const placed = new Set([home.file, ...order.map(page => page.file)]);
  const orphans = markdownFiles.filter(name => !placed.has(name));
  const missing = [...placed].filter(name => !markdownFiles.includes(name));

  if (orphans.length > 0 || missing.length > 0) {
    for (const name of orphans) {
      console.error(`docs/${name} is in no section of docs-src/nav.mjs, so nothing would link to it.`);
    }
    for (const name of missing) {
      console.error(`docs-src/nav.mjs lists docs/${name}, which does not exist.`);
    }
    process.exit(1);
  }
}

function collect(index, rendered, page) {
  const target = page.file.replace(/\.md$/, '.html');
  for (const entry of rendered.search) {
    index.push({
      page: page.title,
      section: page.section,
      href: entry.depth === 1 ? target : `${target}#${entry.slug}`,
      heading: entry.heading,
      text: entry.text
    });
  }
}

async function copyAssets() {
  const assets = ['theme.css', 'docs.js', 'favicon.svg'];
  for (const name of assets) {
    await copyFile(join(here, 'assets', name), join(outDir, 'assets', name));
  }

  const fonts = await readdir(join(here, 'assets', 'fonts'));
  for (const name of fonts) {
    await copyFile(join(here, 'assets', 'fonts', name), join(outDir, 'assets', 'fonts', name));
  }
}

if (!existsSync(docsDir)) {
  console.error(`No docs/ next to ${here}. Run this from the repository.`);
  process.exit(1);
}

await main();

