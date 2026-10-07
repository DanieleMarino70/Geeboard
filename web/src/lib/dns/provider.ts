import { bare } from "@/domain/text";
import "server-only";
import { PlatformError } from "@/domain/errors";
import type { DnsKind, DnsRecord, RecordKind, WantedRecord } from "@/domain/dns/rules";
import { logger } from "../log";

/* What the panel asks of a DNS provider, and no more: whether the token
   works, what is at a name, write one record there, remove it. A record is an
   A, an AAAA or an SRV; a provider that cannot hold one of them says so when
   it is asked to, and the ops do not ask it for one it has said it cannot
   (providerHoldsSrv). Cloudflare and DuckDNS answer these differently enough
   that each has a file; the ops read this interface and never the
   difference. */
export interface DnsClient {
  kind: DnsKind;
  zone: string;
  /** Throws DNS_TOKEN_REFUSED or DNS_PROVIDER_FAILED; returns what it learned (a zone id, for Cloudflare). */
  probe(): Promise<{ zoneId?: string }>;
  /** The records at a name, of any kind; an SRV's content is `priority weight port target`. Empty for a provider that cannot list. */
  read(name: string): Promise<DnsRecord[]>;
  /** Write a record, replacing record `id` when given. Returns the provider's id for the record, if it has one. */
  write(record: WantedRecord, marker: string, id: string | null): Promise<string | null>;
  /** Remove a record (by `id` where the provider has ids). */
  remove(record: { kind: RecordKind; name: string }, id: string | null): Promise<void>;
}

export const DNS_TIMEOUT_MS = 10_000;

/* A provider that could not be asked at all — it did not answer in time, or could
   not be reached — as against one that answered and said no. The first says
   nothing about the record and a good deal about the next call: the poller does
   not make it again for every server in the same pass, since each would wait
   its whole timeout for the same silence. */
export class ProviderUnreachable extends PlatformError {
  constructor(message: string) {
    super("DNS_PROVIDER_FAILED", message);
    this.name = "ProviderUnreachable";
  }
}

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
    throw new ProviderUnreachable(`${name} ${bare(reason)}.`);
  }
}
