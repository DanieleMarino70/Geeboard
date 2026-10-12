import assert from "node:assert/strict";
import { test } from "node:test";
import { holds } from "../src/domain/access/permissions.ts";
import { PALWORLD } from "../src/domain/games/definitions/palworld.ts";
import { RUST } from "../src/domain/games/definitions/rust.ts";
import { SATISFACTORY } from "../src/domain/games/definitions/satisfactory.ts";
import { POSTER_FOCUS_Y, posterFocusY, posterSourceOf, postersShownTo } from "../src/domain/games/poster.ts";
import { allGames } from "../src/domain/games/registry.ts";

/* The poster as the square mark beside a server's name (Cover, ui.tsx): where it is cut, and whom a page shows it to. How it is drawn is
   covers.test's; that the pages and the route agree on whom, against a real database, is verify:covers's. */

test("a poster's square mark is cut from the top unless its definition names another height, and never from outside the picture", () => {
  assert.equal(POSTER_FOCUS_Y, 0);
  assert.equal(posterFocusY({ steam: 892970 }), 0);
  assert.equal(posterFocusY({ steam: 892970, focusY: 0.3 }), 0.3);
  assert.equal(posterFocusY({ url: "https://store-images.s-microsoft.com/image/x", sha256: "a".repeat(64), width: 720, height: 1080, focusY: 1 }), 1);
  assert.equal(posterFocusY({ steam: 892970, focusY: 1.5 }), 1);
  assert.equal(posterFocusY({ steam: 892970, focusY: -0.2 }), 0);
  assert.equal(posterFocusY({ steam: 892970, focusY: Number.NaN }), POSTER_FOCUS_Y);
});

test("each shipped poster is cut where its name is: the foot for Terraria and Project Zomboid, the top for the rest (looked at 2026-10-13)", () => {
  const cut = Object.fromEntries(
    allGames().flatMap((game) => {
      const source = posterSourceOf(game);
      return source ? [[game.id, posterFocusY(source)]] : [];
    }),
  );
  assert.deepEqual(cut, { "minecraft-java": 0, "minecraft-bedrock": 0, terraria: 1, "project-zomboid": 1, valheim: 0, "garrys-mod": 0 });
  // A definition that names a height names one inside the picture: 1.5 is a typo, not a crop.
  for (const game of [...allGames(), RUST, PALWORLD, SATISFACTORY]) {
    const named = game.poster && !("none" in game.poster) ? game.poster.focusY : undefined;
    if (named !== undefined) assert.ok(named >= 0 && named <= 1, `${game.id}: focusY ${named}`);
  }
});

const settled = { id: "u1", passwordSetAt: new Date("2026-10-01T00:00:00Z"), twoFactor: true };

test("a page shows the posters to whoever the route serves them to: a role that may read the games, past the account page", () => {
  for (const role of ["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const) {
    assert.equal(postersShownTo({ ...settled, role }), holds(role, "game.read"), role);
  }
  // A member reaches their own dashboard (member-home.tsx) and their servers' pages, and holds game.read: they see the posters.
  assert.equal(postersShownTo({ ...settled, role: "MEMBER", twoFactor: false }), true, "a member need not enrol");
});

test("nobody signed in, and an account the panel holds on the account page, get the drawn marks: a poster would be a refusal", () => {
  assert.equal(postersShownTo(null), false);
  assert.equal(postersShownTo({ ...settled, role: "ADMIN", twoFactor: false }), false, "an admin not yet enrolled");
  assert.equal(postersShownTo({ ...settled, role: "OWNER", passwordSetAt: null }), false, "an owner still on the temporary password");
});
