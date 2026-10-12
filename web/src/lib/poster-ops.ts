import "server-only";
import {
  backoffMs,
  coversEnabled,
  hostAllowed,
  judgePoster,
  judgePosterAddresses,
  POSTER_MAX_BYTES,
  posterCandidates,
  posterDue,
  posterKey,
  posterSourceOf,
  RECHECK_MS,
} from "@/domain/games/poster";
import { allGames } from "@/domain/games/registry";
import type { GameDefinition, PosterSource } from "@/domain/games/types";
import { userAgent } from "@/domain/net/user-agent";
import { db } from "./db";
import { GuardedFailure, GuardedRefusal, guardedFetch } from "./net/guarded-fetch";

/* The panel fetches each game's poster itself, keeps it, and from then on needs nobody to show it.

   The poller calls refreshPosters when it starts and every hour after; a page never does (lib/game-posters.ts reads the rows). Each game
   is asked about when its row says: never asked, at once; a definition that names another source than the row was written for, at once;
   after a fetch that worked, a month later, with the ETag and Last-Modified it was given, so an unchanged image is a 304 or the same bytes
   again; after one that failed, an hour, six hours, then a day. A failure never takes away the poster that was stored: the old one stays,
   and a game that never had one keeps its drawn cover.

   What leaves the machine: one GET per game that is due, to a host of the list in domain/games/poster.ts, with the name every request of
   this panel carries and an Accept that asks for the original JPEG or PNG — the CDN in front of minecraft.net answers an Accept that lists
   AVIF first with another file, and an image pinned by its hash has to be the same bytes for everybody. No cookie, no credential, nothing
   about this panel. GEEBOARD_COVERS=off makes none, and the pages draw every cover. */

export type PosterTransport = (url: URL, headers: Record<string, string>) => Promise<Response>;

const TIMEOUT_MS = 20_000;
const MAX_HOPS = 3;

/* The call itself, through the guarded fetch: the host's name is looked up once, every address it gave is judged, and the connection goes
   to one of those; at most 2 MB and one byte is read, which is enough to know an answer is too large. Redirects are not followed there:
   fetchPoster below follows one only to another address of the list. */
export const guardedTransport: PosterTransport = (url, headers) =>
  guardedFetch(url, { headers, timeoutMs: TIMEOUT_MS, maxBytes: POSTER_MAX_BYTES + 1, judge: judgePosterAddresses });

/** An answer that is not a poster from a host of the list. `message` is for a person and the log. */
export class PosterRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosterRefusal";
  }
}

async function fetchPoster(start: string, headers: Record<string, string>, transport: PosterTransport): Promise<{ response: Response; url: string }> {
  let url = new URL(start);
  for (let hop = 0; ; hop++) {
    if (!hostAllowed(url)) throw new PosterRefusal(`${url.protocol === "https:" ? url.hostname : "an address that is not https"} is not a host posters are fetched from`);
    const response = await transport(url, headers);
    const location = response.status >= 300 && response.status < 400 && response.status !== 304 ? response.headers.get("location") : null;
    if (!location) return { response, url: url.toString() };
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_HOPS) throw new PosterRefusal(`it redirected more than ${MAX_HOPS} times`);
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new PosterRefusal("it redirected to an address that is not one");
    }
    if (!hostAllowed(next)) {
      throw new PosterRefusal(`it redirected to ${next.protocol === "https:" ? next.hostname : "an address that is not https"}, which is not a host posters are fetched from`);
    }
    url = next;
  }
}

export interface PosterOutcome {
  game: string;
  /* stored: a new image is kept. unchanged: asked again, and it is the one already kept. refused: an answer that is not this game's poster
     (the wrong type, too large, another image than the definition names, a host off the list). failed: no answer to judge. */
  result: "stored" | "unchanged" | "refused" | "failed";
  /** Why, for refused and failed: a sentence, with a host and never a path. */
  why?: string;
  type?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface PosterReport {
  ran: boolean;
  skipped?: "off";
  outcomes: PosterOutcome[];
  /** Rows of games that no longer name a poster, removed: those games show their drawn cover. */
  removed: number;
}

export interface RefreshOptions {
  now?: Date;
  env?: Record<string, string | undefined>;
  /** How a request is made; the guarded fetch unless a test says otherwise. */
  transport?: PosterTransport;
  /** The games to look at; the ones the registry offers unless a test says otherwise. */
  games?: readonly Pick<GameDefinition, "id" | "poster">[];
}

type Source = Exclude<PosterSource, { none: string }>;
type Row = { sha256: string | null; sourceKey: string | null; sourceUrl: string | null; etag: string | null; lastModified: string | null; failures: number; nextAttemptAt: Date | null };

export async function refreshPosters(options: RefreshOptions = {}): Promise<PosterReport> {
  if (!coversEnabled(options.env)) return { ran: false, skipped: "off", outcomes: [], removed: 0 };
  const now = options.now ?? new Date();
  const transport = options.transport ?? guardedTransport;
  const wanted = (options.games ?? allGames()).flatMap((game) => {
    const source = posterSourceOf(game);
    return source ? [{ id: game.id, source }] : [];
  });

  // A game that names no poster any more has none: its row goes, and the pages draw its cover.
  const { count: removed } = await db.gamePoster.deleteMany({ where: { gameId: { notIn: wanted.map((w) => w.id) } } });
  const rows = new Map(
    (
      await db.gamePoster.findMany({
        where: { gameId: { in: wanted.map((w) => w.id) } },
        select: { gameId: true, sha256: true, sourceKey: true, sourceUrl: true, etag: true, lastModified: true, failures: true, nextAttemptAt: true },
      })
    ).map((row) => [row.gameId, row]),
  );

  const outcomes: PosterOutcome[] = [];
  // One at a time: six small files, and nothing waits on them.
  for (const { id, source } of wanted) {
    const row = rows.get(id) ?? null;
    if (!posterDue(row, source, now)) continue;
    outcomes.push(await refreshOne(id, source, row, now, transport));
  }
  return { ran: true, outcomes, removed };
}

async function refreshOne(gameId: string, source: Source, row: Row | null, now: Date, transport: PosterTransport): Promise<PosterOutcome> {
  const key = posterKey(source);
  // The stored image is this source's: the next answer may be "the same", and the validators it came with go with the request.
  const fits = row?.sha256 != null && row.sourceKey === key && (!("url" in source) || row.sha256 === source.sha256);

  const failed = async (result: "refused" | "failed", why: string): Promise<PosterOutcome> => {
    const failures = (row?.failures ?? 0) + 1;
    const data = { sourceKey: key, checkedAt: now, failures, nextAttemptAt: new Date(now.getTime() + backoffMs(failures)), error: why };
    await db.gamePoster.upsert({ where: { gameId }, create: { gameId, ...data }, update: data });
    return { game: gameId, result, why };
  };

  const candidates = posterCandidates(source);
  for (const [i, candidate] of candidates.entries()) {
    const host = new URL(candidate).host;
    const headers: Record<string, string> = { accept: "image/jpeg, image/png", "user-agent": userAgent() };
    /* Both validators, when there are both: Steam's CDN answers If-None-Match alone with the whole file and If-Modified-Since with a 304
       (measured 2026-10-12); the Microsoft Store's answers neither, and its unchanged bytes are the same hash, which counts as unchanged. */
    if (fits && row.sourceUrl === candidate) {
      if (row.etag) headers["if-none-match"] = row.etag;
      if (row.lastModified) headers["if-modified-since"] = row.lastModified;
    }

    let answer: { response: Response; url: string };
    try {
      answer = await fetchPoster(candidate, headers, transport);
    } catch (error) {
      if (error instanceof PosterRefusal || error instanceof GuardedRefusal) return failed("refused", `${host}: ${error.message}`);
      // A fixed phrase: a network error's own text names the address, path and all.
      return failed("failed", `${host} ${error instanceof GuardedFailure ? error.message : "could not be reached"}`);
    }
    const { response, url } = answer;
    const validators = { etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };

    if (response.status === 304) {
      if (!fits) return failed("failed", `${host} answered 304 to a request that asked for the whole image`);
      await db.gamePoster.update({ where: { gameId }, data: { checkedAt: now, failures: 0, nextAttemptAt: new Date(now.getTime() + RECHECK_MS), error: null, ...validators } });
      return { game: gameId, result: "unchanged" };
    }
    // Steam's larger poster is missing for a game whose store page has only the other: the next address.
    if (response.status === 404 && i < candidates.length - 1) continue;
    if (!response.ok) return failed("failed", `${host} answered HTTP ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const declared = response.headers.get("content-length");
    const judged = judgePoster(source, bytes, declared === null ? null : Number(declared));
    if (!judged.ok) return failed("refused", judged.why);
    const { poster } = judged;

    const kept = { sourceKey: key, sourceUrl: url, checkedAt: now, failures: 0, nextAttemptAt: new Date(now.getTime() + RECHECK_MS), error: null, ...validators };
    if (row?.sha256 === poster.sha256) {
      await db.gamePoster.update({ where: { gameId }, data: kept });
      return { game: gameId, result: "unchanged" };
    }
    const image = { bytes, contentType: poster.type, sha256: poster.sha256, width: poster.width, height: poster.height, fetchedAt: now };
    await db.gamePoster.upsert({ where: { gameId }, create: { gameId, ...kept, ...image }, update: { ...kept, ...image } });
    return { game: gameId, result: "stored", type: poster.type, bytes: bytes.length, width: poster.width, height: poster.height };
  }
  return failed("failed", "no address of the poster answered");
}
