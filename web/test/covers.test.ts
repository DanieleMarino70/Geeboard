import assert from "node:assert/strict";
import { test } from "node:test";
import { coverFor, drawnCovers } from "../src/components/covers.tsx";
import { allGames } from "../src/domain/games/registry.ts";

/* The covers, checked the way the registry is: by asking the registry.

   A game offered in the panel with no drawing is not a bug that breaks a
   page — it falls back to the stripes — but it is a gap somebody should
   see here rather than on the Games page months later. */

test("every game the panel offers has a cover drawn for it", () => {
  const missing = allGames()
    .map((game) => game.id)
    .filter((id) => coverFor(id) === null);

  assert.deepEqual(missing, [], `no cover for: ${missing.join(", ")}`);
});

test("a game nobody has drawn falls back rather than throwing", () => {
  // What a server whose catalog row is gone hands the component.
  assert.equal(coverFor(null), null);
  assert.equal(coverFor(undefined), null);
  assert.equal(coverFor("rust"), null);
  assert.equal(coverFor(""), null);
});

test("nothing is drawn for a game that is not in the registry", () => {
  const known = new Set(allGames().map((game) => game.id));
  const strays = drawnCovers().filter((id) => !known.has(id));

  // A drawing for a parked game would be dead weight until it returns.
  assert.deepEqual(strays, [], `drawn but not offered: ${strays.join(", ")}`);
});
