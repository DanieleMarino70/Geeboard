import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PALWORLD } from "../src/domain/games/definitions/palworld.ts";
import { RUST } from "../src/domain/games/definitions/rust.ts";
import { SATISFACTORY } from "../src/domain/games/definitions/satisfactory.ts";
import {
  BACKOFF_MS,
  POSTER_HOSTS,
  POSTER_MAX_BYTES,
  RECHECK_MS,
  backoffMs,
  coversEnabled,
  hostAllowed,
  judgePoster,
  judgePosterAddresses,
  posterCandidates,
  posterDue,
  posterKey,
  posterSourceOf,
  posterSrc,
  sniffImage,
} from "../src/domain/games/poster.ts";
import { PARKED, allGames } from "../src/domain/games/registry.ts";
import type { GameDefinition } from "../src/domain/games/types.ts";
import { GIF, HTML, SVG, jpeg, png, webpExtended, webpLossless, webpLossy } from "./fixtures/poster-images.ts";

/* A game's real poster, as the panel judges it before it keeps it: what a file is (from its bytes), how large, from where, and whether it is
   the image a definition names. The fetching and the serving are verify:covers's, against a real Postgres and a stand-in for the CDN. */

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/* ── What a file is ── */

test("a JPEG, a PNG and a still WebP are read for their type and size from their bytes", () => {
  assert.deepEqual(sniffImage(jpeg(600, 900)), { type: "image/jpeg", width: 600, height: 900 });
  assert.deepEqual(sniffImage(png(20, 30)), { type: "image/png", width: 20, height: 30 });
  assert.deepEqual(sniffImage(webpLossy(720, 1080)), { type: "image/webp", width: 720, height: 1080 });
  assert.deepEqual(sniffImage(webpLossless(300, 450)), { type: "image/webp", width: 300, height: 450 });
  assert.deepEqual(sniffImage(webpExtended(1200, 1800)), { type: "image/webp", width: 1200, height: 1800 });
});

test("an SVG, a GIF, a page and an animated WebP are not posters, whatever the server called them", () => {
  for (const [label, bytes] of [["svg", SVG], ["gif", GIF], ["html", HTML], ["empty", Buffer.alloc(0)]] as const) {
    const sniffed = sniffImage(bytes);
    assert.ok("refused" in sniffed && /not a JPEG, PNG or WebP/.test(sniffed.refused), `${label}: ${JSON.stringify(sniffed)}`);
  }
  const animated = sniffImage(webpExtended(600, 900, true));
  assert.ok("refused" in animated && /animated/.test(animated.refused), JSON.stringify(animated));
});

test("a file that starts as an image and has no size in it is refused", () => {
  const cut = jpeg(600, 900).subarray(0, 40);
  assert.ok("refused" in sniffImage(cut), "a JPEG cut before its frame header");
  assert.ok("refused" in sniffImage(png(20, 30).subarray(0, 16)), "a PNG cut inside its header");
  // The image data starts and no frame header came first.
  assert.ok("refused" in sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0])));
});

/* ── From where ── */

test("a poster is fetched over https from the listed hosts only, on their usual port and with no credentials", () => {
  assert.deepEqual([...POSTER_HOSTS].sort(), ["shared.akamai.steamstatic.com", "store-images.s-microsoft.com"]);
  assert.equal(hostAllowed("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/892970/library_600x900_2x.jpg"), true);
  assert.equal(hostAllowed("https://store-images.s-microsoft.com/image/apps.808.x"), true);
  for (const refused of [
    "http://shared.akamai.steamstatic.com/a.jpg",
    "https://shared.akamai.steamstatic.com.example.net/a.jpg",
    "https://evil.shared.akamai.steamstatic.com/a.jpg",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/892970/library_600x900.jpg",
    "https://www.minecraft.net/content/dam/a.png",
    "https://shared.akamai.steamstatic.com:8443/a.jpg",
    "https://user:pw@store-images.s-microsoft.com/image/x",
    "https://127.0.0.1/a.jpg",
    "file:///etc/passwd",
    "not an address",
  ]) {
    assert.equal(hostAllowed(refused), false, refused);
  }
});

test("a listed host that resolves to an address of this machine's network is not called", () => {
  assert.deepEqual(judgePosterAddresses(["23.45.67.89", "2a02:26f0::1"]), { ok: true });
  for (const address of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "169.254.169.254", "::1", "fd00:ec2::254"]) {
    assert.equal(judgePosterAddresses(["23.45.67.89", address]).ok, false, address);
  }
  assert.equal(judgePosterAddresses([]).ok, false);
});

/* ── How large, and which image ── */

const steam = { steam: 892970 } as const;

test("more than 2 MB is not a poster, and a download cut short is not kept as one", () => {
  const big = Buffer.concat([jpeg(600, 900, 0), Buffer.alloc(POSTER_MAX_BYTES, 0x55)]);
  const tooBig = judgePoster(steam, big);
  assert.ok(!tooBig.ok && /larger than 2 MB/.test(tooBig.why), JSON.stringify(!tooBig.ok && tooBig.why));
  const atLimit = jpeg(600, 900, POSTER_MAX_BYTES - jpeg(600, 900, 0).length);
  assert.equal(atLimit.length, POSTER_MAX_BYTES);
  assert.equal(judgePoster(steam, atLimit).ok, true, "exactly 2 MB is accepted");
  const whole = jpeg(600, 900);
  const cut = judgePoster(steam, whole, whole.length + 500);
  assert.ok(!cut.ok && /cut short/.test(cut.why));
  assert.equal(judgePoster(steam, whole, whole.length).ok, true);
});

test("an image that stops before its own end is a download cut short, even from a server that sent no length", () => {
  const fixed = (bytes: Buffer) => ({ url: "https://store-images.s-microsoft.com/image/x", sha256: sha(bytes), width: 200, height: 300 });
  for (const [label, bytes] of [["jpeg", jpeg(600, 900)], ["png", png(200, 300)]] as const) {
    const cut = bytes.subarray(0, bytes.length - 6);
    const judged = judgePoster(label === "png" ? fixed(cut) : steam, cut);
    assert.ok(!judged.ok && /cut short/.test(judged.why), `${label}: ${JSON.stringify(judged)}`);
  }
  // A WebP says its own length: one that says more than arrived was cut.
  const webp = Buffer.from(webpExtended(600, 900));
  webp.writeUInt32LE(webp.readUInt32LE(4) + 10, 4);
  const cutWebp = judgePoster(steam, webp);
  assert.ok(!cutWebp.ok && /cut short/.test(cutWebp.why), JSON.stringify(cutWebp));
  // A JPEG may carry a few bytes of padding after its end marker.
  assert.equal(judgePoster(steam, Buffer.concat([jpeg(600, 900), Buffer.alloc(4)])).ok, true);
  assert.equal(judgePoster(steam, webpLossless(600, 900)).ok, true);
});

test("a poster is taller than it is wide, and not larger than a card should decode", () => {
  for (const [width, height, reason] of [
    [900, 600, /taller than it is wide/],
    [600, 600, /taller than it is wide/],
    [40, 60, /between 64 and 4096/],
    [4000, 9000, /between 64 and 4096/],
  ] as const) {
    const judged = judgePoster(steam, jpeg(width, height));
    assert.ok(!judged.ok && reason.test(judged.why), `${width}×${height}: ${JSON.stringify(judged)}`);
  }
  const ok = judgePoster(steam, jpeg(600, 900));
  assert.ok(ok.ok && ok.poster.type === "image/jpeg" && ok.poster.width === 600 && ok.poster.sha256 === sha(jpeg(600, 900)));
});

test("an image at a fixed address that is not the one the definition names is not kept: the site moved or changed it", () => {
  const image = png(200, 300, 1);
  const source = { url: "https://store-images.s-microsoft.com/image/x", sha256: sha(image), width: 200, height: 300 };
  const right = judgePoster(source, image);
  assert.ok(right.ok && right.poster.sha256 === source.sha256 && right.poster.type === "image/png");

  const changed = judgePoster(source, png(200, 300, 2));
  assert.ok(!changed.ok && /not the one the definition names/.test(changed.why) && /moved or changed/.test(changed.why), JSON.stringify(changed));
  // Upper-case hex in a definition is the same hash.
  assert.equal(judgePoster({ ...source, sha256: source.sha256.toUpperCase() }, image).ok, true);
  const resized = judgePoster({ ...source, width: 720, height: 1080 }, image);
  assert.ok(!resized.ok && /not the 720 × 1080/.test(resized.why));
  // An SVG with the right name is still an SVG.
  const svg = judgePoster({ ...source, sha256: sha(SVG) }, SVG);
  assert.ok(!svg.ok && /not a JPEG, PNG or WebP/.test(svg.why));
});

/* ── When ── */

test("a poster is asked for when there is none, when the definition names another source, and when its row says", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const key = posterKey(steam);
  assert.equal(posterDue(null, steam, now), true);
  assert.equal(posterDue({ sourceKey: key, nextAttemptAt: new Date(now.getTime() + 1000) }, steam, now), false);
  assert.equal(posterDue({ sourceKey: key, nextAttemptAt: now }, steam, now), true);
  assert.equal(posterDue({ sourceKey: key, nextAttemptAt: null }, steam, now), true);
  // Another app id, or a new hash at the same address, is a new source: at once, whatever the clock says.
  assert.equal(posterDue({ sourceKey: "steam:896660", nextAttemptAt: new Date(now.getTime() + RECHECK_MS) }, steam, now), true);
  const fixed = { url: "https://store-images.s-microsoft.com/image/x", sha256: "a".repeat(64), width: 720, height: 1080 };
  assert.equal(posterDue({ sourceKey: posterKey(fixed), nextAttemptAt: new Date(now.getTime() + 1000) }, { ...fixed, sha256: "b".repeat(64) }, now), true);
});

test("after a failure the next attempt waits an hour, then six, then a day for as long as it goes on; a stored poster, a month", () => {
  const H = 3600_000;
  assert.deepEqual([1, 2, 3, 4, 10].map(backoffMs), [H, 6 * H, 24 * H, 24 * H, 24 * H]);
  assert.deepEqual([...BACKOFF_MS], [H, 6 * H, 24 * H]);
  assert.equal(RECHECK_MS, 30 * 24 * H);
});

test("GEEBOARD_COVERS=off turns it off, in the words the update check takes", () => {
  assert.equal(coversEnabled({}), true);
  assert.equal(coversEnabled({ GEEBOARD_COVERS: "on" }), true);
  for (const off of ["off", "OFF", " 0 ", "false", "no", "never"]) assert.equal(coversEnabled({ GEEBOARD_COVERS: off }), false, off);
});

test("a page's address for a poster carries the start of its hash, so it can be cached for as long as the image is that one", () => {
  assert.equal(posterSrc("valheim", "0123456789abcdef".repeat(4)), "/games/valheim/poster?v=0123456789ab");
});

/* ── The definitions ── */

const shipped = allGames();
const parked = [RUST, PALWORLD, SATISFACTORY];

test("every game Geeboard ships or keeps parked names its poster, or says why it has none", () => {
  assert.deepEqual(parked.map((g) => g.id).sort(), [...PARKED].sort(), "a parked game this test does not look at");
  for (const game of [...shipped, ...parked]) {
    assert.ok(game.poster, `${game.id} names no poster: give it one (measured), or { none: "why" }`);
    if ("none" in game.poster) assert.ok(game.poster.none.trim().length >= 10, `${game.id}: say why it has no poster`);
  }
});

/* The app ids that are the dedicated server's or a tool's, which are not a store page: Valheim's server is 896660, its store page 892970. */
function serverAppIds(game: GameDefinition): number[] {
  const ids = game.versionSources.flatMap((s) => (s.provider === "steam" ? [s.appId] : []));
  if (game.install.kind === "steamcmd") ids.push(game.install.appId);
  return ids;
}

test("a Steam poster names the store page's app id, and not the dedicated server's", () => {
  const expected: Record<string, number> = { valheim: 892970, "project-zomboid": 108600, "garrys-mod": 4000, terraria: 105600, rust: 252490, palworld: 1623730, satisfactory: 526870 };
  for (const game of [...shipped, ...parked]) {
    const source = posterSourceOf(game);
    if (!source || !("steam" in source)) continue;
    assert.ok(Number.isInteger(source.steam) && source.steam > 0, game.id);
    assert.equal(source.steam, expected[game.id], `${game.id}: the store page measured on 2026-10-12`);
    assert.ok(!serverAppIds(game).includes(source.steam), `${game.id}: ${source.steam} is the server's app id`);
    for (const address of posterCandidates(source)) assert.ok(hostAllowed(address), address);
  }
});

test("a poster at a fixed address is on a listed host, with a sha256 and a portrait size, as Minecraft's are", () => {
  const fixed = [...shipped, ...parked].flatMap((game) => {
    const source = posterSourceOf(game);
    return source && "url" in source ? [{ game, source }] : [];
  });
  assert.deepEqual(fixed.map((f) => f.game.id).sort(), ["minecraft-bedrock", "minecraft-java"]);
  for (const { game, source } of fixed) {
    assert.ok(hostAllowed(source.url), `${game.id}: ${source.url}`);
    assert.match(source.sha256, /^[0-9a-f]{64}$/, game.id);
    assert.ok(source.height > source.width && source.width >= 64 && source.height <= 4096, game.id);
  }
  assert.notEqual(fixed[0]!.source.sha256, fixed[1]!.source.sha256, "two editions, two posters");
});

test("a community game has no poster, even one copied into its definition by hand", () => {
  const copy = { ...shipped.find((g) => g.id === "terraria")!, id: "community-terraria" };
  assert.ok(copy.poster);
  assert.equal(posterSourceOf(copy), null);
  assert.equal(posterSourceOf(undefined), null);
  assert.equal(posterSourceOf({ id: "terraria", poster: { none: "no store page" } }), null);
});
