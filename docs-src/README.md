# docs-src

The generator that turns `docs/*.md` into the published site.

```bash
cd docs-src && npm ci     # once: one dependency, marked, build time only
node docs-src/build.mjs   # docs/*.md  →  site/
node docs-src/check-links.mjs
node docs-src/serve.mjs   # http://localhost:4000
```

`site/` is not committed. `.github/workflows/docs.yml` runs these three
commands on every push and publishes the result to GitHub Pages.

## What is where

| | |
| --- | --- |
| `build.mjs` | Reads the Markdown, writes the pages, copies the assets, writes the search index and `.nojekyll` |
| `nav.mjs` | The order the site reads in — three sections, and the installation path. The only place that decides it |
| `markdown.mjs` | `marked`, plus the anchors, the link rewriting and the code blocks |
| `highlight.mjs` | Comments, strings, numbers and a word list, per language |
| `template.mjs` | The page shell: top bar, three columns, drawer, palette, footer |
| `check-links.mjs` | Walks the built site and fails on a dead link, a missing anchor, a lost address or a mangled code block |
| `assets/` | The stylesheet, the script, the icon, and the two fonts with their licences |

## The rules it keeps

**A page's address never changes.** Every Markdown file becomes
`<name>.html` at the root, which is what the Jekyll site served.
`reference.html` is linked from outside this repository and cannot move.

**An anchor is the same here and on GitHub.** `slugify` in `markdown.mjs`
follows GitHub's rule, including the detail that each space becomes its own
hyphen — `## Lines — what counts` is `#lines--what-counts`, with two.

**The Markdown stays the source.** A link to `games.md#shipped` is followed
by GitHub as a file and rewritten here into `games.html#shipped`. Nothing in
`docs/` is written by the build, and nothing in `docs/` is site-only syntax.

**The site asks nothing of the network.** The fonts and the stylesheet are
served from the site itself. A page opened with the network off is a page
that reads.

**The search searches.** `assets/search.js` is built from the same parse as
the pages, one entry per heading, and it is loaded when the palette is first
opened.

## Adding a page

Write the Markdown in `docs/`, then add it to a section in `nav.mjs`. The
build fails on a file that is in neither — a page nothing links to is how a
documentation site starts lying.
