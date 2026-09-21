import "server-only";
import { PlatformError } from "@/domain/errors";
import { summariseWorkshop, workshopIdFrom } from "@/domain/games/mods";
import { logger } from "./log";

/* The Steam Workshop, as far as the panel is concerned.

   Two endpoints, and the difference between them is the whole design of
   this file. Asking Steam about items whose ids you already have needs
   no credentials at all, so pasting a Workshop link always works, on
   every installation, out of the box. *Searching* does need a Steam Web
   API key, because Steam only offers search through the keyed API — so
   the browsing catalogue is there when an operator has set one and
   absent, and said to be absent, when they have not.

   What never happens here is downloading a mod. The bytes are fetched by
   the game itself, on the node, from the ids the panel writes into its
   settings — the panel deals in numbers and titles and never proxies
   somebody's mod through itself. */

export { workshopIdFrom };

const DETAILS = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const QUERY = "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/";
const TIMEOUT_MS = 10_000;

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
}

function asItem(raw: Record<string, unknown>): WorkshopItem | null {
  const id = String(raw.publishedfileid ?? "");
  if (!/^\d{1,20}$/.test(id)) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => (typeof tag === "object" && tag ? String((tag as { tag?: unknown }).tag ?? "") : String(tag)))
        .filter((tag) => tag.length > 0 && tag.length < 40)
        .slice(0, 6)
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
  };
}

async function ask(url: string, init: RequestInit): Promise<Record<string, unknown>> {
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
    throw new PlatformError(
      "MOD_PROVIDER_FAILED",
      response.status === 403
        ? "Steam refused the request — check STEAM_API_KEY on the panel."
        : `Steam answered ${response.status}.`,
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

/* Details for ids already in hand. No key, by design: this is what makes
   pasting a Workshop link work on an installation that has set nothing
   up, and what lets the panel put a name to a mod it already has. */
export async function workshopDetails(ids: string[]): Promise<WorkshopItem[]> {
  const wanted = [...new Set(ids.filter((id) => /^\d{1,20}$/.test(id)))].slice(0, 50);
  if (wanted.length === 0) return [];

  const body = new URLSearchParams({ itemcount: String(wanted.length) });
  wanted.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));

  const payload = await ask(DETAILS, { method: "POST", body });
  const details = (payload.response as { publishedfiledetails?: Array<Record<string, unknown>> } | undefined)
    ?.publishedfiledetails;

  return (details ?? [])
    // result 1 is "here it is"; anything else is deleted, hidden or never existed.
    .filter((raw) => Number(raw.result ?? 0) === 1)
    .map(asItem)
    .filter((item): item is WorkshopItem => item !== null);
}

/** Whether this installation can browse the Workshop at all. */
export function workshopSearchAvailable(): boolean {
  return Boolean(process.env.STEAM_API_KEY);
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
  appId: number,
  text: string,
  options: { page?: number; perPage?: number; tag?: string } = {},
): Promise<WorkshopSearch> {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    throw new PlatformError(
      "MOD_SEARCH_UNAVAILABLE",
      "Searching the Workshop needs a Steam Web API key: set STEAM_API_KEY on the panel. A Workshop link or id can be added without one.",
    );
  }

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

  const payload = await ask(`${QUERY}?${params}`, { method: "GET" });
  const response = payload.response as
    | { publishedfiledetails?: Array<Record<string, unknown>>; total?: number }
    | undefined;

  const items = (response?.publishedfiledetails ?? [])
    .map(asItem)
    .filter((item): item is WorkshopItem => item !== null);

  return { items, more: items.length === perPage };
}
