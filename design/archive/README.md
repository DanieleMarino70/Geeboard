# archive

**History, not instructions.**

`deliverable-shape-and-priority/` is the hand-off bundle Claude Design
exported for the panel's first design, committed with the first commit of
this repository on 2026-09-08. Its README is written to a coding agent and
tells it to read the prototypes and recreate them. That was done: the canvas
in `../canvas/` and the panel in `web/` are the result, and both have moved on
since (0.9.0's contrast tokens, 0.11.0's redesign). Nothing in it is to be
followed, and it does not describe the panel as it is.

It is kept because two things still lean on it:

- `../canvas/lib.mjs` took its vocabulary — the tokens, the icons, the pieces —
  from `project/Geeboard.dc.html` and `project/Geeboard Design System.dc.html`,
  and says so. They are the record of where a value came from.
- `project/support.js` is the Claude Design runtime that every artboard in
  `../canvas/` loads as `./support.js`, and this is its only copy here.

The paths inside the bundle's README (`deliverable-shape-and-priority/…`) are
its own, from before it was moved here.
