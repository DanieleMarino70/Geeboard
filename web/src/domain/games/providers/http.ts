import { PlatformError } from "../../errors";

/* Talking to somebody else's API.

   Three rules, and every provider gets them for free by going through
   here rather than calling fetch itself.

   Bounded: an upstream having a slow day must not hold a request open.
   Cached: the catalog is read far more often than upstream changes, and
   a page render is not a reason to hit Steam. Loud: a provider that
   fails says so, because a version list that is quietly stale is worse
   than one that is visibly missing. */

const DEFAULT_TIMEOUT_MS = 8_000;

/* Long enough that a page render never triggers a fetch in practice —
   the catalog sync is what refreshes upstream — and short enough that a
   manual sync after a game update is not fighting a stale entry. */
const DEFAULT_TTL_MS = 30 * 60_000;

interface Entry {
  at: number;
  value: unknown;
}

const cache = new Map<string, Entry>();

export interface FetchOptions {
  timeoutMs?: number;
  ttlMs?: number;
  /** Skip the cache and refresh it. Used by the catalog sync. */
  refresh?: boolean;
}

/* A cached GET returning JSON.

   Failures are thrown as VERSION_PROVIDER_FAILED so the resolver can
   record which provider failed and carry on with the rest — the static
   provider is always there, so a version list is never empty because a
   remote source was down. */
export async function getJson<T>(
  url: string,
  options: FetchOptions = {},
  init: RequestInit = {},
): Promise<T> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const hit = cache.get(url);

  if (!options.refresh && hit && Date.now() - hit.at < ttl) {
    return hit.value as T;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        // Identifying the caller is basic manners towards a free API.
        "user-agent": "geeboard/0.1 (+https://github.com/geeboard)",
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    /* A stale answer beats no answer when the network is the problem —
       but only for a failure to reach it at all, never for a refusal,
       which is upstream telling us something. */
    if (hit) return hit.value as T;
    throw new PlatformError("VERSION_PROVIDER_FAILED", describe(cause, url), { cause });
  }

  if (!response.ok) {
    throw new PlatformError(
      "VERSION_PROVIDER_FAILED",
      `${hostOf(url)} answered ${response.status}`,
      { details: { status: response.status } },
    );
  }

  let value: T;
  try {
    value = (await response.json()) as T;
  } catch (cause) {
    throw new PlatformError("VERSION_PROVIDER_FAILED", `${hostOf(url)} did not return JSON`, {
      cause,
    });
  }

  cache.set(url, { at: Date.now(), value });
  return value;
}

/** Empties the cache. For tests, and for a sync that must not reuse anything. */
export function clearVersionCache(): void {
  cache.clear();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the provider";
  }
}

function describe(cause: unknown, url: string): string {
  const timedOut = cause instanceof Error && cause.name === "TimeoutError";
  return `${hostOf(url)} ${timedOut ? "timed out" : "could not be reached"}`;
}
