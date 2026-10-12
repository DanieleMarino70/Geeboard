# design

The design material Geeboard was drawn from. No image, no site and no test
reads anything here: the panel's design system is `web/src/components/` and
`web/src/app/globals.css`, and the documentation site's is
`docs-src/assets/theme.css`. This is what they were drawn from, kept so a
screen can be redrawn and compared.

| | |
| --- | --- |
| `canvas/` | The design system as 26 `.dc.html` artboards on three pages (the product, its foundations, the flows and the phone), laid out by `canvas.json`. The panel was built from it. `Tokens.dc.html` holds the same values as `web/src/app/globals.css`: change one, change the other |
| `docs-site/` | *Obsidian Telemetry*, the documentation site's design. `DESIGN.md` is the system, `code.html` a drawing of it, `screen.png` a picture of the drawing. `docs-src/assets/theme.css` is the same thing written out as a stylesheet |
| `archive/` | The first hand-off, which the canvas took its vocabulary from. History, not instructions: `archive/README.md` says what is still used from it |

## Rebuilding the canvas

`canvas/build.mjs` writes every artboard and `canvas.json` from `lib.mjs` (the
tokens, the icons and the pieces every artboard shares) and the
`screens-*.mjs`, `sheets.mjs` and `mobile.mjs` modules. It writes into the
directory it runs in:

```bash
cd design/canvas && node build.mjs     # wrote 26 artboards + canvas.json
```

Read `git diff` after a build. 0.9.0 changed `Tokens.dc.html` by hand and not
`lib.mjs` — the `-fg` text tokens, `--control-border`, the heat steps and the
light theme's darker accent — so a build writes `Tokens.dc.html` without them.
Keep what that edit added.

The artboards load `./support.js`, the Claude Design runtime, which Claude
Design supplies. The only copy in this repository is the archive's.
`canvas/geeboard-panel.html`, the seeded canvas the Claude Design seed helper
makes out of them, is about 4 MB and ignored.
