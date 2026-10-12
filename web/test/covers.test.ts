import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coverFor, drawnCovers } from "../src/components/covers.tsx";
import { PosterArt } from "../src/components/poster.tsx";
import { Cover } from "../src/components/ui.tsx";
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
  const html = poster({ game: "valheim", tag: "VALHEIM", poster: { src: "/games/valheim/poster", width: 600, height: 900, focusY: 0 } });
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

/* The square mark beside a server's name (Cover, ui.tsx): the poster cut square when the page has one for this person, and otherwise the
   drawing it has always been. */
const mark = (props: Parameters<typeof Cover>[0]) => renderToStaticMarkup(createElement(Cover, props));
const VALHEIM = { src: "/games/valheim/poster?v=0123456789ab", width: 600, height: 900, focusY: 0 };

test("with a poster, the square mark is the picture in the same box: its size, edge and radius, loaded lazily, and silent", () => {
  const html = mark({ tag: "VALHEIM", game: "valheim", poster: VALHEIM, size: 32, radius: 9 });
  assert.match(html, /^<img /);
  assert.match(html, /src="\/games\/valheim\/poster\?v=0123456789ab"/);
  // The box, not the picture's own size: a 600 × 900 file drawn 32 × 32, cut to cover it.
  assert.match(html, /width="32"/);
  assert.match(html, /height="32"/);
  assert.match(html, /style="width:32px;height:32px;border-radius:9px;object-position:50% 0%"/);
  assert.match(html, /class="[^"]*\bobject-cover\b/);
  assert.match(html, /class="[^"]*\bborder border-line\b/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  // The server's or the game's name is written beside it.
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
});

test("the poster is cut from the height its definition names: the foot of a poster whose name is there", () => {
  assert.match(mark({ tag: "TERR-\nARIA", game: "terraria", poster: { ...VALHEIM, focusY: 1 }, size: 28, radius: 8 }), /object-position:50% 100%/);
  assert.match(mark({ tag: "X", game: "terraria", poster: { ...VALHEIM, focusY: 0.3 } }), /object-position:50% 30%/);
});

test("without a poster the square mark is what it always was: every game the panel offers its drawing, any other the stripes", () => {
  for (const game of allGames()) {
    const html = mark({ tag: game.art, game: game.id, poster: null, size: 52, radius: 13 });
    assert.equal(html, mark({ tag: game.art, game: game.id, size: 52, radius: 13 }), game.id);
    assert.match(html, /^<svg[^>]*viewBox="0 0 64 64"/, game.id);
    assert.doesNotMatch(html, /<img/, game.id);
  }
  const stripes = mark({ tag: "LANT ERN", game: "community-lantern" });
  assert.match(stripes, /repeating-linear-gradient/);
  assert.doesNotMatch(stripes, /<img|<svg/);
});
