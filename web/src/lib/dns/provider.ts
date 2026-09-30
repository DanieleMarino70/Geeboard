import "server-only";
import { PlatformError } from "@/domain/errors";
import type { AddressFamily, DnsKind, DnsRecord } from "@/domain/dns/rules";
import { logger } from "../log";

/* What the panel asks of a DNS provider, and no more: whether the token
   works, what is at a name, write one address record there, remove it.
   Cloudflare and DuckDNS answer these differently enough that each has
   a file; the ops read this interface and never the difference. */
export interface DnsClient {
  kind: DnsKind;
  zone: string;
  /** Throws DNS_TOKEN_REFUSED or DNS_PROVIDER_FAILED; returns what it learned (a zone id, for Cloudflare). */
  probe(): Promise<{ zoneId?: string }>;
  /** The address records at a host. Empty for a provider that cannot list. */
  read(host: string): Promise<DnsRecord[]>;
  /** Write `address` at `host`, replacing record `id` when given. Returns the provider's id for the record, if it has one. */
  write(host: string, family: AddressFamily, address: string, marker: string, id: string | null): Promise<string | null>;
  /** Remove the record at `host` (by `id` where the provider has ids). */
  remove(host: string, id: string | null): Promise<void>;
}

export const DNS_TIMEOUT_MS = 10_000;

/* One call to a provider, with the panel's rules: a bounded wait, no
   cache, and a failure that says which of two different things went
   wrong — the provider could not be asked, or it answered and said no.
   The token is in the request and never in what is thrown or logged. */
export async function askProvider(name: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { "user-agent": "geeboard", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "is unreachable";
    logger.warn("dns provider call failed", { provider: name, reason });
    throw new PlatformError("DNS_PROVIDER_FAILED", `${name} ${reason}.`);
  }
}
