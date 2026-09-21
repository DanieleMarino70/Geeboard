# brand

The Geeboard mark, and the files everything else copies it from.

| | |
| --- | --- |
| `geeboard-mark.svg` | The mark, in one colour, taking `currentColor`. This is the one the panel and the site use, so the mark is the accent of whatever it sits in |
| `geeboard-mark-brand.svg` | The same shape in the brand green, `#00E676`. For a background whose colour is not known: the README, a link preview, a slide |
| `geeboard-mark-two-tone.svg` | The lockup as the artwork draws it — green ring, charcoal racks. For a light ground only: the racks vanish against anything dark |
| `geeboard-icon.svg` | The mark on its tile. A browser tab and an application icon, where the mark needs a ground of its own |
| `apple-touch-icon.png` | 180×180, rendered from `geeboard-icon.svg` |
| `og.png` | 1200×630, the image a link to Geeboard unfurls as |
| `source/Geeboard_logos.png` | The sheet the mark was drawn from. A source, not an asset: nothing serves it |

## Where the mark is used

- **The site**: `docs-src/template.mjs` reads `geeboard-mark.svg` at build
  time and writes it into every page; `docs-src/build.mjs` publishes the icon
  as the favicon, plus `apple-touch-icon.png` and `og.png`.
- **The panel**: `web/src/components/brand-mark.tsx` carries the same path,
  because the panel's image is built from `web/` alone and cannot read a file
  outside it. `web/test/brand.test.ts` fails when the two stop agreeing.
  `web/src/app/icon.svg` and `web/src/app/apple-icon.png` are Next's file
  conventions for the tab and the home screen.
- **The README**: the brand-green mark, next to the title.
- **The repository's social preview**: `og.png`, uploaded by hand in
  *Settings → General → Social preview*. GitHub has no file for it.

## The two greens

The artwork's green is `#00E676`. The product's accent is lime — `#9fe833`
in the site, `--accent` in the panel — and it is the colour of a primary
action and an active page. Two greens seventy degrees apart on the same
screen read as a theme that has broken, not as a logo beside an interface,
so the mark inside the product takes the accent and the brand green is kept
for where the mark stands alone.

## Changing the mark

Edit the SVG, then regenerate what is derived from it. The PNGs were rendered
by pointing a headless browser at an HTML page holding the SVG at its exact
size — no rasteriser is a dependency of this repository, and two files that
change once a year do not earn one. `web/src/components/brand-mark.tsx` holds
a copy of the path; the test will tell you to update it.

## Taking it off a fork

Delete this directory, then: the `<img>` at the top of `README.md` and the
paragraph in its licence section, `markPath` in `docs-src/template.mjs`,
the brand files in `copyAssets` in `docs-src/build.mjs`,
`web/src/components/brand-mark.tsx` with its three call sites,
`web/src/app/icon.svg`, `web/src/app/apple-icon.png`, and
`web/test/brand.test.ts`.
