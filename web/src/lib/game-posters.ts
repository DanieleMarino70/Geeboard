import "server-only";
import type { User } from "@prisma/client";
import { accountGate } from "@/domain/access/account";
import { can } from "@/domain/access/permissions";
import { coversEnabled, posterSourceOf, posterSrc, type PosterType } from "@/domain/games/poster";
import { findGame } from "@/domain/games/registry";
import { db } from "./db";

/* The posters the poller fetched (lib/poster-ops.ts), as the pages read them: from the database and never from the network, so a page is
   as quick offline as on, and a game with nothing stored is simply left out and drawn (components/covers.tsx). Off with GEEBOARD_COVERS=off,
   and for a game whose definition no longer names a poster, or a community game, which may not name one. */

export interface PosterRef {
  src: string;
  width: number;
  height: number;
}

/** The stored poster of each game asked for, read from the database only — never the network. A game with none is left out. */
export async function postersFor(gameIds: string[]): Promise<Map<string, PosterRef>> {
  const found = new Map<string, PosterRef>();
  if (!coversEnabled()) return found;
  const ids = [...new Set(gameIds)].filter((id) => posterSourceOf(findGame(id)) !== null);
  if (ids.length === 0) return found;
  let rows: Array<{ gameId: string; sha256: string | null; width: number | null; height: number | null }>;
  try {
    rows = await db.gamePoster.findMany({ where: { gameId: { in: ids }, sha256: { not: null } }, select: { gameId: true, sha256: true, width: true, height: true } });
  } catch {
    // A database this release has not migrated yet has no table: every cover is drawn, and the page says nothing about it.
    return found;
  }
  for (const row of rows) {
    if (row.sha256 && row.width && row.height) found.set(row.gameId, { src: posterSrc(row.gameId, row.sha256), width: row.width, height: row.height });
  }
  return found;
}

const SERVED: readonly PosterType[] = ["image/jpeg", "image/png", "image/webp"];

export interface StoredPoster {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: PosterType;
  sha256: string;
}

/** One game's stored image, for the route that serves it; null when there is none to serve. */
export async function readPoster(gameId: string): Promise<StoredPoster | null> {
  if (!coversEnabled() || posterSourceOf(findGame(gameId)) === null) return null;
  const row = await db.gamePoster.findUnique({ where: { gameId }, select: { bytes: true, contentType: true, sha256: true } }).catch(() => null);
  if (!row?.bytes || !row.sha256 || !SERVED.includes(row.contentType as PosterType)) return null;
  return { bytes: new Uint8Array(row.bytes), contentType: row.contentType as PosterType, sha256: row.sha256 };
}

function refusal(status: number, text: string): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

/* GET /games/<id>/poster, for app/games/[id]/poster/route.ts, which hands it the person signed in (null for nobody).

   What a page shows a signed-in person who may read the games, and nothing for anybody else: the poster is a publisher's image the panel
   keeps for its own pages, not a file to hand out. Served as the type its bytes were found to be, with nosniff and a policy that lets the
   file do nothing but be shown, and cached by this browser only (it is behind a sign-in): for a year when the address carries the hash of
   the image it is (`?v=`, which postersFor writes), and otherwise asked again each time, answered 304 while the image is the same. */
export async function posterResponse(req: Request, gameId: string, user: User | null): Promise<Response> {
  if (!user) return refusal(401, "Sign in to see this.");
  if (accountGate(user)) return refusal(403, "Finish setting up your account first.");
  if (!can(user, "game.read")) return refusal(403, "Your role does not let you see the games.");
  const poster = await readPoster(gameId);
  if (!poster) return refusal(404, "This game has no poster stored, and the panel draws its cover.");

  const etag = `"${poster.sha256}"`;
  const pinned = new URL(req.url).searchParams.get("v") === poster.sha256.slice(0, 12);
  const headers = new Headers({
    "content-type": poster.contentType,
    "x-content-type-options": "nosniff",
    // next.config.ts sends the same for this path, and a header it sets wins over a route's: change both together.
    "content-security-policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": pinned ? "private, max-age=31536000, immutable" : "private, no-cache",
    etag,
  });
  const asked = req.headers.get("if-none-match");
  if (asked && asked.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(poster.bytes.byteLength));
  return new Response(poster.bytes, { status: 200, headers });
}
