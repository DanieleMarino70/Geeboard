// The shell every page is served in: the top bar, the three columns, the
// drawer, the command palette and the footer that says where to go next.
//
// It is a template literal and not a framework on purpose. Twenty-one pages
// of documentation do not need a runtime, and a page that is finished HTML
// when it leaves the build is a page that still reads with the network gone.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml } from './highlight.mjs';
import { sections, installPath } from './nav.mjs';

const REPO = 'https://github.com/DanieleMarino70/Geeboard';
const SITE = 'https://danielemarino70.github.io/Geeboard/';

// The mark is read out of brand/ at build time and written into every page,
// rather than fetched as a file: it is 1.3 KB, it is on every screen, and a
// mark that arrives after the text is a mark that flickers. Inline it also
// takes `currentColor`, which is what makes it lime here, dark on a light
// ground, and the accent of whatever surface it is dropped on.
const markPath = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'brand', 'geeboard-mark.svg'),
  'utf8'
).match(/<path[^>]*\sd="([^"]+)"/)[1];

function mark(size, { decorative = true } = {}) {
  const label = decorative
    ? 'aria-hidden="true"'
    : 'role="img" aria-label="Geeboard"';
  return `<svg class="mark" viewBox="0 0 128 128" width="${size}" height="${size}" ${label}><path fill="currentColor" d="${markPath}"/></svg>`;
}

const icons = {
  menu: '<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M1.5 3.5h13v1.4h-13zM1.5 7.3h13v1.4h-13zM1.5 11.1h13v1.4h-13z"/></svg>',
  close: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3.2 2.2 8 7l4.8-4.8 1 1L9 8l4.8 4.8-1 1L8 9l-4.8 4.8-1-1L7 8 2.2 3.2z"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M7 1a6 6 0 1 0 3.7 10.7l3.3 3.3 1-1-3.3-3.3A6 6 0 0 0 7 1Zm0 1.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Z"/></svg>',
  github: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-1-.9-1.3-.9-1.3-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1 0-.2-.3-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2Z"/></svg>',
  list: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 3.2h2v1.5H2zM5.5 3.2h8.5v1.5H5.5zM2 7.2h2v1.5H2zM5.5 7.2h8.5v1.5H5.5zM2 11.2h2v1.5H2zM5.5 11.2h8.5v1.5H5.5z"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 10.6 3.4 6l1-1L8 8.6 11.6 5l1 1z"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5.7 11.7 2 12.6l.9-3.7 7-7 2.8 2.8-7 7Zm5.6-9.1 1.2-1.2 2.8 2.8-1.2 1.2-2.8-2.8Z"/></svg>'
};

function chip(text) {
  return `<span class="chip">${escapeHtml(text)}</span>`;
}

function head({ title, description, version, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="generator" content="docs-src/build.mjs — Geeboard ${escapeHtml(version)}">
<meta name="color-scheme" content="dark">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Geeboard">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${SITE}assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="assets/fonts/geist-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/jetbrains-mono-variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/theme.css">
${extraHead}</head>`;
}

function topbar({ version, showMenu }) {
  return `<header class="topbar">
<div class="topbar-inner">
<div class="topbar-left">
${showMenu ? `<button class="icon-button menu-button" type="button" data-open-drawer aria-label="Open the navigation" aria-expanded="false" aria-controls="site-nav">${icons.menu}</button>` : ''}
<a class="brand" href="index.html">${mark(22)}<span class="brand-name">Geeboard</span></a>
<span class="version-chip">v${escapeHtml(version)}</span>
</div>
<div class="topbar-right">
<button class="search-trigger" type="button" data-open-search aria-label="Search the documentation">${icons.search}<span class="search-trigger-text">Search</span><kbd data-shortcut-hint>Ctrl K</kbd></button>
<a class="icon-button" href="${REPO}" target="_blank" rel="noopener noreferrer" aria-label="Geeboard on GitHub">${icons.github}</a>
</div>
</div>
</header>`;
}

function navTree(currentFile) {
  const groups = sections
    .map(section => {
      const items = section.pages
        .map(page => {
          const href = `${page.file.replace(/\.md$/, '')}.html`;
          const active = page.file === currentFile;
          return `<li><a href="${href}"${active ? ' aria-current="page"' : ''}>${escapeHtml(page.title)}</a></li>`;
        })
        .join('\n');
      return `<div class="nav-group">
<p class="nav-eyebrow">${escapeHtml(section.title)}</p>
<ul>
${items}
</ul>
</div>`;
    })
    .join('\n');

  return `<nav class="nav" id="site-nav" aria-label="Documentation">
<div class="nav-head">
<a class="nav-brand" href="index.html">${mark(20)}<span>Geeboard</span></a>
<button class="icon-button nav-close" type="button" data-close-drawer aria-label="Close the navigation">${icons.close}</button>
</div>
<a class="nav-home${currentFile === 'index.md' ? ' is-current' : ''}" href="index.html">Home</a>
${groups}
<div class="nav-foot">
<a href="${REPO}/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a>
<a href="${REPO}" target="_blank" rel="noopener noreferrer">Source</a>
</div>
</nav>`;
}

function tocRail(toc) {
  if (toc.length === 0) return '<aside class="toc" aria-hidden="true"></aside>';
  const items = toc
    .map(
      entry =>
        `<li class="toc-${entry.depth}"><a href="#${entry.slug}">${escapeHtml(entry.text)}</a></li>`
    )
    .join('\n');
  return `<aside class="toc" aria-label="On this page">
<p class="toc-title">On this page</p>
<ul class="toc-list">
${items}
</ul>
</aside>`;
}

function tocDropdown(toc) {
  if (toc.length === 0) return '';
  const items = toc
    .map(
      entry =>
        `<li class="toc-${entry.depth}"><a href="#${entry.slug}">${escapeHtml(entry.text)}</a></li>`
    )
    .join('\n');
  return `<details class="toc-drop">
<summary><span class="toc-drop-label">${icons.list} On this page</span><span class="toc-drop-count">${toc.length} sections</span></summary>
<ul class="toc-list">
${items}
</ul>
</details>`;
}

// The three steps of an installation, shown at the top of the three pages
// they run across, so a reader who is halfway through can see where they are
// without scrolling back.
function pathRail(currentFile) {
  const index = installPath.findIndex(step => step.file === currentFile);
  if (index === -1) return '';
  const steps = installPath
    .map((step, position) => {
      const state = position === index ? 'is-current' : position < index ? 'is-done' : '';
      const number = String(position + 1).padStart(2, '0');
      const label = escapeHtml(step.label);
      const inner = `<span class="step-number">${number}</span><span class="step-label">${label}</span>`;
      return position === index
        ? `<li class="step ${state}" aria-current="step">${inner}</li>`
        : `<li class="step ${state}"><a href="${step.href}">${inner}</a></li>`;
    })
    .join('');
  return `<ol class="path-rail" aria-label="Installation path">${steps}</ol>`;
}

function breadcrumb(section, title) {
  return `<nav class="crumbs" aria-label="Breadcrumb">
<a href="index.html">Docs</a>${icons.chevron}<span>${escapeHtml(section)}</span>${icons.chevron}<span class="crumb-current">${escapeHtml(title)}</span>
</nav>`;
}

function pager(previous, next) {
  const card = (page, kind) => {
    if (!page) return '<span class="pager-empty"></span>';
    const href = `${page.file.replace(/\.md$/, '')}.html`;
    return `<a class="pager-card pager-${kind}" href="${href}">
<span class="pager-kind">${kind === 'prev' ? 'Previous' : 'Next'}</span>
<span class="pager-title">${escapeHtml(page.title)}</span>
</a>`;
  };
  return `<nav class="pager" aria-label="Previous and next page">${card(previous, 'prev')}${card(next, 'next')}</nav>`;
}

function overlays() {
  return `<div class="scrim" data-close-drawer hidden></div>
<div class="palette" id="palette" hidden>
<div class="palette-backdrop" data-close-search></div>
<div class="palette-box" role="dialog" aria-modal="true" aria-label="Search the documentation">
<div class="palette-head">
${icons.search}
<input type="search" id="palette-input" placeholder="Search the documentation" autocomplete="off" spellcheck="false" aria-label="Search the documentation">
<button class="palette-esc" type="button" data-close-search>Esc</button>
</div>
<div class="palette-results" id="palette-results" role="listbox" aria-label="Results"></div>
<p class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</p>
</div>
</div>`;
}

export function renderDocPage({
  file,
  title,
  description,
  version,
  sectionTitle,
  bodyHtml,
  toc,
  previous,
  next
}) {
  return `${head({
    title: `${title} · Geeboard`,
    description,
    version
  })}
<body class="doc">
<a class="skip-link" href="#content">Skip to the content</a>
${topbar({ version, showMenu: true })}
<div class="shell">
${navTree(file)}
<main class="content" id="content">
${breadcrumb(sectionTitle, title)}
${pathRail(file)}
${tocDropdown(toc)}
<article class="prose">
${bodyHtml}
</article>
<footer class="page-foot">
<a class="edit-link" href="${REPO}/blob/main/docs/${file}" target="_blank" rel="noopener noreferrer">${icons.edit} Edit this page on GitHub</a>
${pager(previous, next)}
</footer>
</main>
${tocRail(toc)}
</div>
${overlays()}
<script src="assets/docs.js" defer></script>
</body>
</html>
`;
}

export function renderHome({ version, title, titleSlug, lede, bodyHtml, primary, secondary }) {
  const cards = sections
    .map(section => {
      const first = section.pages[0];
      const href = `${first.file.replace(/\.md$/, '')}.html`;
      const links = section.pages
        .slice(0, 5)
        .map(
          page =>
            `<li><a href="${page.file.replace(/\.md$/, '')}.html">${escapeHtml(page.title)}</a></li>`
        )
        .join('');
      return `<article class="home-card">
<p class="nav-eyebrow">${escapeHtml(section.title)}</p>
<p class="home-card-blurb">${escapeHtml(section.blurb)}</p>
<ul class="home-card-links">${links}</ul>
<a class="home-card-go" href="${href}">Start here</a>
</article>`;
    })
    .join('\n');

  return `${head({
    title: `${title} · an open-source game server panel`,
    description: lede,
    version
  })}
<body class="home">
<a class="skip-link" href="#content">Skip to the content</a>
${topbar({ version, showMenu: false })}
<main class="landing" id="content">
<section class="hero">
<div class="hero-glow" aria-hidden="true"></div>
<div class="hero-mark">${mark(72, { decorative: false })}</div>
${chip('Version ' + version)}
<h1 id="${escapeHtml(titleSlug)}">${escapeHtml(title)}</h1>
<p class="hero-lede">${escapeHtml(lede)}</p>
<div class="hero-actions">
<a class="button button-primary" href="${primary.href}">${escapeHtml(primary.label)}</a>
<a class="button button-secondary" href="${secondary.href}">${escapeHtml(secondary.label)}</a>
</div>
<p class="hero-note">The documentation starts on a bare server and ends with a game server running.</p>
</section>
<section class="home-cards">
${cards}
</section>
<article class="prose home-prose">
${bodyHtml}
</article>
</main>
${overlays()}
<script src="assets/docs.js" defer></script>
</body>
</html>
`;
}
