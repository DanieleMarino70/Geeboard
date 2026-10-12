import { createHash } from "node:crypto";
import { accountGate } from "../access/account";
import { can, type Actor } from "../access/permissions";
import { classifyAddress } from "../net/address";
import { isCommunityId } from "./registry";
import type { GameDefinition, PosterSource } from "./types";

/* A game's real poster: where it may come from, what it has to be, and when it is asked for again.

   The images are the publishers', and Geeboard does not ship them: each panel fetches the ones it shows, keeps them in its own database and
   serves them from there, so a page never waits on the internet and a panel that is offline still has what it fetched. The fetching is the
   poller's (lib/poster-ops.ts); this is what it decides with, kept apart from the network so that it is tested with bytes.

   Three rules hold whatever the definition says. The address is https, on one of the hosts below and nowhere else, redirects included. What
   comes back is at most 2 MB, and its type is read from its first bytes, not from what the server says: a JPEG, a PNG or a still WebP, which
   are pictures and nothing else (no SVG, which is a document that can carry script). Its size is read from its header, and a poster is taller
   than it is wide and no larger than a browser should be asked to decode for a card. A fixed address (a game not on Steam) also names the
   image it must give, by sha256 and size: anything else means the site moved or changed it, and the image is not kept. */

export const POSTER_MAX_BYTES = 2 * 1024 * 1024;

/* The only hosts a poster is fetched from, measured on 2026-10-12. Steam's store serves the library posters from this one (the older
   cdn.cloudflare/cdn.akamai/steamcdn-a hosts give the same bytes and are not needed). The Microsoft Store's image host has Minecraft's,
   because minecraft.net publishes no vertical poster (see definitions/minecraft-java.ts). */
export const POSTER_HOSTS: readonly string[] = ["shared.akamai.steamstatic.com", "store-images.s-microsoft.com"];

/** No side of a poster is longer than this: 600 × 900 and 720 × 1080 are what the sources give, and a card shows a fraction of it. */
export const POSTER_MAX_SIDE = 4096;
const POSTER_MIN_SIDE = 64;

/** A stored poster is asked about again after this, with a conditional request: a store's poster changes once a year if at all. */
export const RECHECK_MS = 30 * 24 * 3600_000;
const HOUR = 3600_000;
/** How long the next attempt waits after the first, second, and every further failure in a row. */
export const BACKOFF_MS: readonly number[] = [HOUR, 6 * HOUR, 24 * HOUR];

export type PosterType = "image/jpeg" | "image/png" | "image/webp";

type Env = Record<string, string | undefined>;

/** GEEBOARD_COVERS=off: no request is made for a poster, and the pages draw every cover. */
export function coversEnabled(env: Env = process.env): boolean {
  const v = (env.GEEBOARD_COVERS ?? "on").trim().toLowerCase();
  return !["off", "0", "false", "no", "never"].includes(v);
}

/* Where a game's poster comes from, or null when it has none: a game that says why not, a definition that says nothing, and any community
   game, whose manifest may not name one (domain/games/manifest.ts) and which is not asked about here even if a definition did. */
export function posterSourceOf(game: Pick<GameDefinition, "id" | "poster"> | undefined): Exclude<PosterSource, { none: string }> | null {
  const source = game?.poster;
  if (!game || isCommunityId(game.id) || !source || "none" in source) return null;
  return source;
}

/* The definition's poster in one string, kept in the row: a definition that names another app id, address or hash is fetched again at
   once. The hash is part of it, so a release that pins a new image at the same address is a new source. */
export function posterKey(source: Exclude<PosterSource, { none: string }>): string {
  return "steam" in source ? `steam:${source.steam}` : `url:${source.url}#${source.sha256}`;
}

/* The addresses to try, in order. Steam's store has a poster at twice the size and one at the size its name says; the larger is the one a
   card wants, and a game whose store page has only the other is answered 404 for the first. */
export function posterCandidates(source: Exclude<PosterSource, { none: string }>): string[] {
  if ("steam" in source) {
    const base = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${source.steam}`;
    return [`${base}/library_600x900_2x.jpg`, `${base}/library_600x900.jpg`];
  }
  return [source.url];
}

/** Whether an address is one a poster may be fetched from: https, on a host of the list, on its usual port, with no credentials. */
export function hostAllowed(address: URL | string): boolean {
  let url: URL;
  try {
    url = typeof address === "string" ? new URL(address) : address;
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password && POSTER_HOSTS.includes(url.hostname);
}

/* The addresses a poster host resolved to: every one has to be on the internet. A host of the list is a public CDN, and one that answers
   with an address of this machine's network is not the CDN (a resolver that lies, a hosts file somebody edited). */
export function judgePosterAddresses(addresses: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (addresses.length === 0) return { ok: false, reason: "The poster's host does not resolve to any address." };
  for (const address of addresses) {
    if (classifyAddress(address) !== "public") return { ok: false, reason: "The poster's host resolved to an address that is not on the internet, so it was not called." };
  }
  return { ok: true };
}

/* ── Reading the bytes ────────────────────────────────────────────── */

export interface Sniffed {
  type: PosterType;
  width: number;
  height: number;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b);
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

/* A JPEG's size is in its start-of-frame segment, after however many others: each segment is a marker and a length, and the walk stops at
   the first frame header, or refuses at the start of the image data without having found one. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // markers that have no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the end, or the image data, and no frame before it
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > b.length) return null;
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | { refused: string } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // A key frame: three bytes of frame tag, the start code, then 14 bits of width and of height.
    if (b.length < 30 || !startsWith(b, [0x9d, 0x01, 0x2a], 23)) return null;
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    // The flags' animation bit: a poster is one picture.
    if (b[20]! & 0x02) return { refused: "is an animated WebP, and a poster is one still picture" };
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** The type and size of an image, read from its bytes; or why it is not one a poster can be. */
export function sniffImage(bytes: Uint8Array): Sniffed | { refused: string } {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(bytes);
    return size ? { type: "image/jpeg", ...size } : { refused: "starts as a JPEG and has no frame header that says its size" };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return { refused: "starts as a PNG and has no header that says its size" };
    return { type: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const size = webpSize(bytes);
    if (!size) return { refused: "starts as a WebP and has no header that says its size" };
    return "refused" in size ? size : { type: "image/webp", ...size };
  }
  return { refused: "is not a JPEG, PNG or WebP image" };
}

/* Whether the file runs to its own end: a JPEG's end-of-image marker (within the last few bytes, past any padding), a PNG's IEND chunk, a
   WebP's RIFF length. A download whose connection dropped is not refused by a server that sent no length, and a JPEG cut in half still
   starts like one: this is what tells. Every poster the shipped sources gave on 2026-10-12 ends this way. */
export function endsWhole(bytes: Uint8Array, type: PosterType): boolean {
  const n = bytes.length;
  if (type === "image/jpeg") {
    for (let i = n - 2; i >= Math.max(2, n - 16); i--) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
    return false;
  }
  if (type === "image/png") return n >= 12 && ascii(bytes, n - 8, 4) === "IEND";
  const declared = (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0;
  return declared + 8 <= n;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface JudgedPoster extends Sniffed {
  sha256: string;
}

/* Whether these bytes are a poster this source may give. `declaredLength` is what the answer said it would send, when it said: fewer bytes
   than that is a download that was cut short, which is not stored as if it were the image. */
export function judgePoster(
  source: Exclude<PosterSource, { none: string }>,
  bytes: Uint8Array,
  declaredLength?: number | null,
): { ok: true; poster: JudgedPoster } | { ok: false; why: string } {
  if (bytes.length > POSTER_MAX_BYTES) return { ok: false, why: `the image is larger than ${POSTER_MAX_BYTES / 1024 / 1024} MB, which no poster is` };
  if (declaredLength != null && Number.isFinite(declaredLength) && declaredLength !== bytes.length) {
    return { ok: false, why: `the download was cut short (${bytes.length} of ${declaredLength} bytes)` };
  }
  if (bytes.length === 0) return { ok: false, why: "the answer was empty" };
  const sniffed = sniffImage(bytes);
  if ("refused" in sniffed) return { ok: false, why: `the file ${sniffed.refused}` };
  if (!endsWhole(bytes, sniffed.type)) return { ok: false, why: "the image stops before its end: the download was cut short" };
  const { width, height } = sniffed;
  if (width < POSTER_MIN_SIDE || height < POSTER_MIN_SIDE || width > POSTER_MAX_SIDE || height > POSTER_MAX_SIDE) {
    return { ok: false, why: `the image is ${width} × ${height}; a poster is between ${POSTER_MIN_SIDE} and ${POSTER_MAX_SIDE} pixels a side` };
  }
  if (height <= width) return { ok: false, why: `the image is ${width} × ${height}, which is not a poster: a poster is taller than it is wide` };
  const sha256 = sha256Hex(bytes);
  if ("url" in source) {
    if (sha256 !== source.sha256.toLowerCase()) {
      return { ok: false, why: `the image at that address is not the one the definition names (its sha256 is ${sha256.slice(0, 12)}…, not ${source.sha256.slice(0, 12)}…): the site moved or changed it` };
    }
    if (width !== source.width || height !== source.height) {
      return { ok: false, why: `the image is ${width} × ${height}, not the ${source.width} × ${source.height} the definition names` };
    }
  }
  return { ok: true, poster: { ...sniffed, sha256 } };
}

/* ── When ─────────────────────────────────────────────────────────── */

/** How long to wait after this many failures in a row: an hour, six, then a day for as long as it goes on. */
export function backoffMs(failures: number): number {
  return BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1]!;
}

export interface PosterSchedule {
  sourceKey: string | null;
  nextAttemptAt: Date | null;
}

/* Whether a game's poster is asked for now. Never asked: yes. A definition that names another source than the row was written for: yes,
   whatever the clock says. Otherwise when the row says, which is a month after one that worked and an hour to a day after one that failed. */
export function posterDue(row: PosterSchedule | null, source: Exclude<PosterSource, { none: string }>, now: Date): boolean {
  if (!row) return true;
  if (row.sourceKey !== posterKey(source)) return true;
  return !row.nextAttemptAt || row.nextAttemptAt.getTime() <= now.getTime();
}

/** The address a page uses for a stored poster: the hash in it, so that it can be cached for as long as the image is the same. */
export function posterSrc(gameId: string, sha256: string): string {
  return `/games/${encodeURIComponent(gameId)}/poster?v=${sha256.slice(0, 12)}`;
}

/* ── The square mark ──────────────────────────────────────────────── */

/* Where the square mark beside a server's name is cut from a poster that names no focusY (types.ts, PosterSource): the top two thirds.
   Looked at on 2026-10-13 at 28–52 px, that is where both Minecrafts, Valheim and Garry's Mod have their names; Terraria and Project
   Zomboid have theirs at the foot and say so in their definitions. */
export const POSTER_FOCUS_Y = 0;

/** How far down a poster its square mark is cut, from 0 (the top) to 1 (the bottom). */
export function posterFocusY(source: Exclude<PosterSource, { none: string }>): number {
  const y = source.focusY;
  return typeof y === "number" && Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : POSTER_FOCUS_Y;
}

/* Whether a page shows this person the stored posters: signed in, past the account page, and allowed to read the games, which is whom the
   route serves them to (lib/game-posters.ts, posterResponse). For anybody else a poster would be a broken image, so the page draws the
   covers. Every role holds game.read today, and every page sends an account that is not set up to the account page first: this is the
   rule that keeps the two from drifting apart, not a case anybody meets. */
export function postersShownTo(user: (Actor & Parameters<typeof accountGate>[0]) | null): boolean {
  return user !== null && accountGate(user) === null && can(user, "game.read");
}
