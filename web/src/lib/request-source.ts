import "server-only";
import { sourceOf, trustedHopsFrom } from "@/domain/access/source";

/* The bucket a request's limits count against: where it came from, as the proxy in front of the panel saw it (an IPv6
   address is its /64). GEEBOARD_TRUSTED_PROXIES is how many proxies are in front, one by default, which is the Caddy the
   installer sets up and the nginx block in the documentation; 0 for a panel that is reached directly, where no header
   is believed. See domain/access/source.ts. */
export function requestSource(headers: { get(name: string): string | null }): string {
  return sourceOf(headers.get("x-forwarded-for"), trustedHopsFrom(process.env.GEEBOARD_TRUSTED_PROXIES));
}
