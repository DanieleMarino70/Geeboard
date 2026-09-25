import "server-only";
import { PlatformError } from "@/domain/errors";
import type { CollectionEntry } from "@/domain/games/collections";
import { summariseWorkshop, workshopIdFrom } from "@/domain/games/mods";
import { logger } from "./log";

/* The Steam Workshop, as far as the panel is concerned.

   Three endpoints, and which of them need a key is the whole design of
   this file. Asking Steam about items whose ids you already have needs
   no credentials at all, and neither does asking what a collection
   holds — so pasting a Workshop link, of an item or of a collection,
   always works, on every installation, out of the box. *Searching* does
   need a Steam Web API key, because Steam only offers search through the
   keyed API — so the browsing catalogue is there when an operator has
   set one and absent, and said to be absent, when they have not. Where
   the key comes from is lib/steam-ops.ts; this file is handed it.

   What never happens here is downloading a mod. The bytes are fetched by
   the game itself, on the node, from the ids the panel writes into its
   settings — the panel deals in numbers and titles and never proxies
   somebody's mod through itself. */

export { workshopIdFrom };

const DETAILS = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTIONS = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";
const QUERY = "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/";
const TIMEOUT_MS = 10_000;
/** Ids per request. Both keyless endpoints answer a hundred at a time, measured. */
const BATCH = 100;
/** Details asked for at once: a collection at its limit, its links, and itself. */
const MAX_DETAILS = 1_100;

/** What the panel shows about an item before it is on a server. */
export interface WorkshopItem {
  id: string;
  title: string;
  /** A sentence, trimmed: Workshop descriptions carry BBCode and essays. */
  summary: string;
  previewUrl: string | null;
  sizeBytes: number;
  /** When its author last changed it, as epoch seconds. Zero when unknown. */
  updatedAt: number;
  /** How many people subscribe to it, as a rough measure of trust. */
  subscriptions: number;
  /** The Workshop's own tags: "Build 42", "Map", "Items". */
  tags: string[];
  /** The game it is for. A link can be to anybody's Workshop. Zero when unknown. */
  appId: number;
}

function asItem(raw: Record<string, unknown>): WorkshopItem | null {
  const id = String(raw.publishedfileid ?? "");
  if (!/^\d{1,20}$/.test(id)) return null;

  /* All of them, within reason: which build an item is for is a tag
     like any other, and it is not always among the first few — Building
     Menu's "Build 41" is second of seven. The card shows three. */
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => (typeof tag === "object" && tag ? String((tag as { tag?: unknown }).tag ?? "") : String(tag)))
        .filter((tag) => tag.length > 0 && tag.length < 40)
        .slice(0, 20)
    : [];

  return {
    id,
    title: String(raw.title ?? `Workshop item ${id}`).slice(0, 200),
    summary: summariseWorkshop(String(raw.short_description ?? raw.description ?? "")),
    previewUrl: typeof raw.preview_url === "string" && raw.preview_url.startsWith("https://") ? raw.preview_url : null,
    sizeBytes: Number(raw.file_size ?? 0) || 0,
    updatedAt: Number(raw.time_updated ?? 0) || 0,
    subscriptions: Number(raw.subscriptions ?? raw.lifetime_subscriptions ?? 0) || 0,
    tags,
    // The keyless endpoint and the search spell it differently.
    appId: Number(raw.consumer_app_id ?? raw.consumer_appid ?? 0) || 0,
  };
}

async function ask(url: string, init: RequestInit, keyed = false): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "is unreachable";
    logger.warn("workshop call failed", { reason });
    throw new PlatformError("MOD_PROVIDER_FAILED", `Steam ${reason}. The mods already on this server are unaffected.`);
  }

  if (!response.ok) {
    logger.warn("workshop call refused", { status: response.status });
    /* Steam answers a key it will not take with a 403 and a page saying
       retrying will not help. Only a keyed call can mean the key. */
    if (keyed && (response.status === 401 || response.status === 403)) {
      throw new PlatformError("MOD_KEY_REFUSED", "Steam refused the Steam Web API key: revoked, mistyped, or never one.");
    }
    throw new PlatformError("MOD_PROVIDER_FAILED", `Steam answered ${response.status}.`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function batches(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
  return out;
}

/* Details for ids already in hand, in the order they were asked for. No
   key, by design: this is what makes pasting a Workshop link work on an
   installation that has set nothing up, and what lets the panel put a
   name to a mod it already has. An id missing from the answer is
   deleted, hidden or never existed.

   Beware that a collection answers here like any item — same result
   code, a size of nothing, and no field saying it is a collection.
   `workshopCollections` is the question that tells them apart. */
export async function workshopDetails(ids: string[]): Promise<WorkshopItem[]> {
  const wanted = [...new Set(ids.filter((id) => /^\d{1,20}$/.test(id)))].slice(0, MAX_DETAILS);
  const found = new Map<string, WorkshopItem>();

  // One after another: a thousand-item collection is eleven small requests, and Steam is not ours to hurry.
  for (const batch of batches(wanted)) {
    const body = new URLSearchParams({ itemcount: String(batch.length) });
    batch.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

    const payload = await ask(DETAILS, { method: "POST", body });
    const details = (payload.response as { publishedfiledetails?: Array<Record<string, unknown>> } | undefined)
      ?.publishedfiledetails;

    for (const raw of details ?? []) {
      // result 1 is "here it is"; anything else is deleted, hidden or never existed.
      if (Number(raw.result ?? 0) !== 1) continue;
      const item = asItem(raw);
      if (item) found.set(item.id, item);
    }
  }

  return wanted.map((id) => found.get(id)).filter((item): item is WorkshopItem => item !== undefined);
}

/* What is inside each of these ids that is a collection, in the
   collection's own order. No key. An id that is not a collection — an
   item, even one listing other items as required — is answered with
   result 9 and is absent from the map, which makes this the one
   reliable way to ask "is this a collection" without a key. */
export async function workshopCollections(ids: string[]): Promise<Map<string, CollectionEntry[]>> {
  const wanted = [...new Set(ids.filter((id) => /^\d{1,20}$/.test(id)))];
  const found = new Map<string, CollectionEntry[]>();

  for (const batch of batches(wanted)) {
    const body = new URLSearchParams({ collectioncount: String(batch.length) });
    batch.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

    const payload = await ask(COLLECTIONS, { method: "POST", body });
    const details = (payload.response as { collectiondetails?: Array<Record<string, unknown>> } | undefined)
      ?.collectiondetails;

    for (const raw of details ?? []) {
      const id = String(raw.publishedfileid ?? "");
      if (Number(raw.result ?? 0) !== 1 || !/^\d{1,20}$/.test(id)) continue;
      const children = (Array.isArray(raw.children) ? (raw.children as Array<Record<string, unknown>>) : [])
        /* `sortorder` is the author's order, starting at 0 in some
           collections and 1 in others; only its order means anything. */
        .map((child) => ({ id: String(child.publishedfileid ?? ""), sort: Number(child.sortorder ?? 0), type: Number(child.filetype ?? -1) }))
        // 0 is an item, 2 a linked collection; nothing else has turned up in one.
        .filter((child) => /^\d{1,20}$/.test(child.id) && (child.type === 0 || child.type === 2))
        .sort((a, b) => a.sort - b.sort)
        .map((child) => ({ id: child.id, collection: child.type === 2 }));
      found.set(id, children);
    }
  }

  return found;
}

/* What each item lists as required on its Workshop page: the items the
   author says it needs, by id. Keyed — measured on 25 September 2026:
   IPublishedFileService/GetDetails answers 401 without a key, and the
   keyless endpoints above do not carry the list at all, GetCollectionDetails
   answering result 9 for an item that has one. So without a key what an
   item needs is not known here, which callers say rather than guess; the
   node still finds a missing requirement once the game has the files. */
const DETAILS_KEYED = "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/";

export async function workshopRequirements(key: string, ids: string[]): Promise<Map<string, string[]>> {
  const wanted = [...new Set(ids.filter((id) => /^\d{1,20}$/.test(id)))].slice(0, MAX_DETAILS);
  const found = new Map<string, string[]>();

  for (const batch of batches(wanted)) {
    const params = new URLSearchParams({ key, includechildren: "true" });
    batch.forEach((id, i) => params.set(`publishedfileids[${i}]`, id));

    const payload = await ask(`${DETAILS_KEYED}?${params}`, { method: "GET" }, true);
    const details = (payload.response as { publishedfiledetails?: Array<Record<string, unknown>> } | undefined)
      ?.publishedfiledetails;

    for (const raw of details ?? []) {
      const id = String(raw.publishedfileid ?? "");
      if (Number(raw.result ?? 0) !== 1 || !/^\d{1,20}$/.test(id)) continue;
      const children = (Array.isArray(raw.children) ? (raw.children as Array<Record<string, unknown>>) : [])
        .map((child) => String(child.publishedfileid ?? ""))
        .filter((child) => /^\d{1,20}$/.test(child) && child !== id);
      found.set(id, [...new Set(children)]);
    }
  }

  return found;
}

export interface WorkshopSearch {
  items: WorkshopItem[];
  /** True when Steam says there are more pages of this search. */
  more: boolean;
}

/* Browsing: the keyed half.

   `query_type` 12 is ranked by unique subscriptions, and — measured
   against the live API rather than read off a wiki — it is also the one
   that honours `search_text`: "vehicles" returns Vanilla Vehicles
   Replacer and More Immersive Vehicles, most-run first. The obvious
   candidates do not: 9 ranks by subscriptions and ignores the text
   entirely, 11 ("by text search") returned the same three items whether
   the box was full or empty, and 3 (trend) matches the text but answers
   with whatever is briefly moving, which on a Zomboid shelf is a mod
   with forty subscribers above one with four million.

   So one query type for both cases: an empty box is the most-run mods,
   and a typed one is the most-run mods matching it. */
const RANKED_BY_SUBSCRIBERS = "12";

export async function searchWorkshop(
  key: string,
  appId: number,
  text: string,
  options: { page?: number; perPage?: number; tag?: string } = {},
): Promise<WorkshopSearch> {
  const perPage = Math.min(Math.max(options.perPage ?? 24, 1), 50);
  const params = new URLSearchParams({
    key,
    appid: String(appId),
    query_type: RANKED_BY_SUBSCRIBERS,
    search_text: text.trim(),
    page: String(Math.max(options.page ?? 1, 1)),
    numperpage: String(perPage),
    return_short_description: "true",
    return_previews: "true",
    return_metadata: "true",
    return_tags: "true",
    return_vote_data: "false",
    /* Ready-to-use items only: a collection is a list of other items and
       cannot be downloaded as one, and the panel would be offering
       something the game cannot load. */
    filetype: "0",
  });
  if (options.tag) params.set("requiredtags[0]", options.tag);

  const payload = await ask(`${QUERY}?${params}`, { method: "GET" }, true);
  const response = payload.response as
    | { publishedfiledetails?: Array<Record<string, unknown>>; total?: number }
    | undefined;

  const items = (response?.publishedfiledetails ?? [])
    .map(asItem)
    .filter((item): item is WorkshopItem => item !== null);

  return { items, more: items.length === perPage };
}
