import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coverFor, drawnCovers } from "../src/components/covers.tsx";
import { PosterArt } from "../src/components/poster.tsx";
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

/* The poster (components/poster.tsx): the game's picture when the panel holds one, the drawing on a 2:3 page when it does not. */
const poster = (props: Parameters<typeof PosterArt>[0]) => renderToStaticMarkup(createElement(PosterArt, props));

test("a poster the panel holds is a plain image: its own size, loaded lazily, and an alt that does not say the name again", () => {
  const html = poster({ game: "valheim", tag: "VALHEIM", poster: { src: "/games/valheim/poster", width: 600, height: 900 } });
  assert.match(html, /^<img /);
  assert.match(html, /src="\/games\/valheim\/poster"/);
  assert.match(html, /width="600"/);
  assert.match(html, /height="900"/);
  assert.match(html, /loading="lazy"/);
  // Empty: the name is written over the poster or beside it, and is not said twice.
  assert.match(html, /alt=""/);
  assert.doesNotMatch(html, /alt="[^"]/);
});

test("with no poster, every game the panel offers is its drawn cover on a 2:3 page, with its colours and its ground carried down", () => {
  for (const game of allGames()) {
    const art = coverFor(game.id)!;
    const html = poster({ game: game.id, tag: game.art, poster: null });
    assert.match(html, /^<svg[^>]*viewBox="0 0 64 96"/, game.id);
    assert.match(html, /aria-hidden="true"/, game.id);
    assert.ok(html.includes(`fill="${art.background}"`), `${game.id}: its background`);
    assert.ok(html.includes(`fill="${art.ground ?? art.background}"`), `${game.id}: its ground`);
    assert.doesNotMatch(html, /<img/, game.id);
  }
});

test("a game nobody has drawn, as a community game always is, is the stripes and its two lines of text, never a broken image", () => {
  const html = poster({ game: "community-lantern", tag: "LANT ERN", poster: undefined });
  assert.match(html, /repeating-linear-gradient/);
  assert.match(html, />LANT ERN</);
  assert.doesNotMatch(html, /<img|<svg/);
});
