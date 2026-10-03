import "server-only";
import { Resolver } from "node:dns/promises";
import { PlatformError } from "@/domain/errors";
import { NOT_IN_ACCOUNT, duckBase, type AddressFamily, type DnsRecord, type RecordKind, type WantedRecord } from "@/domain/dns/rules";
import { logger } from "../log";
import { askProvider, type DnsClient } from "./provider";

/* DuckDNS: one account token, some subdomains under duckdns.org,
   each with one address, and an update endpoint that answers OK or KO.
   There is nothing to create or list — a subdomain is made on the
   DuckDNS site, and the panel points it — so "the record at a name" is
   whatever the subdomain resolves to, and a write is an update, which
   is the same whether it is the first or the hundredth.

   A name is written through its subdomain: `aurora.myserver.duckdns.org`
   is `myserver`'s address, which DuckDNS gives to every name under it
   (see duckBase), so what is updated is `myserver`, and a server needs
   no subdomain of its own.

   Two rules the endpoint makes necessary. An update with no `ip=` sets
   the subdomain to the caller's address — the panel's, which is never
   the node's — so the address is always sent. And DuckDNS asks not to
   be updated when nothing changed, which the ops honour by writing only
   when the node's address moved. The base URL is a variable only so the
   verify script can stand a fake DuckDNS up on a local port. */
const BASE = process.env.DUCKDNS_BASE?.replace(/\/$/, "") || "https://www.duckdns.org";

export class DuckDnsClient implements DnsClient {
  readonly kind = "duckdns" as const;
  readonly zone = "duckdns.org";

  constructor(
    private readonly token: string,
    /** One of the account's subdomains, which the probe updates in place. */
    private readonly checkHost: string | null,
  ) {}

  private async update(sub: string, params: Record<string, string>): Promise<string[]> {
    const query = new URLSearchParams({ domains: sub, token: this.token, verbose: "true", ...params });
    const response = await askProvider("DuckDNS", `${BASE}/update?${query.toString()}`, { method: "GET" });
    const text = (await response.text()).trim();
    const lines = text.split("\n").map((l) => l.trim());
    if (!response.ok) {
      logger.warn("duckdns call refused", { status: response.status });
      throw new PlatformError("DNS_PROVIDER_FAILED", `DuckDNS answered ${response.status}.`);
    }
    if (lines[0] !== "OK") {
      logger.warn("duckdns said KO", { subdomain: sub });
      throw new PlatformError("DNS_TOKEN_REFUSED", `DuckDNS refused ${sub}.duckdns.org: the token is wrong, or that subdomain is ${NOT_IN_ACCOUNT}.`);
    }
    return lines;
  }

  /* What a subdomain resolves to now, so the probe can write it back
     unchanged; null when it has no address record. A resolver that
     cannot answer at all is a different thing from a name with nothing
     at it, and is thrown: writing anything on a guess would move the
     record. DUCKDNS_PROBE_ADDRESS stands in for the lookup in the verify
     script, where nothing under duckdns.org is real — an address, or
     `none` for a subdomain with no record yet. */
  private async currentAddress(host: string): Promise<{ family: AddressFamily; address: string } | null> {
    const stub = process.env.DUCKDNS_PROBE_ADDRESS;
    if (stub === "none") return null;
    if (stub) return { family: stub.includes(":") ? "AAAA" : "A", address: stub };
    const resolver = new Resolver();
    const empty = (error: unknown) => {
      const code = (error as { code?: string }).code ?? "";
      return code === "ENODATA" || code === "ENOTFOUND";
    };
    try {
      const v4 = await resolver.resolve4(host);
      if (v4[0]) return { family: "A", address: v4[0] };
    } catch (error) {
      if (!empty(error)) throw new PlatformError("DNS_PROVIDER_FAILED", `${host} could not be looked up, so the token was not checked: ${(error as Error).message}`);
    }
    try {
      const v6 = await resolver.resolve6(host);
      if (v6[0]) return { family: "AAAA", address: v6[0] };
    } catch (error) {
      if (!empty(error)) throw new PlatformError("DNS_PROVIDER_FAILED", `${host} could not be looked up, so the token was not checked: ${(error as Error).message}`);
    }
    return null;
  }

  async probe(): Promise<{ zoneId?: string }> {
    const sub = this.checkHost ? duckBase(this.checkHost) ?? duckBase(`${this.checkHost}.duckdns.org`) : null;
    if (!sub) throw new PlatformError("VALIDATION_FAILED", "Name one of the account's subdomains to check the token with.");
    const current = await this.currentAddress(`${sub}.duckdns.org`);
    /* Written back as it is: an update has to carry an address, and this
       one changes nothing. A subdomain with no record yet is cleared,
       which changes nothing either. It used to be sent the documentation
       address instead, on the guess that DuckDNS would treat it as a
       placeholder; DuckDNS takes it like any other, and on the first real
       account a Check on a subdomain the panel had just cleared left it
       pointing at 192.0.2.1. */
    const params: Record<string, string> = current
      ? current.family === "A"
        ? { ip: current.address }
        : { ipv6: current.address }
      : { clear: "true" };
    await this.update(sub, params);
    return {};
  }

  async read(): Promise<DnsRecord[]> {
    // Nothing to list: an update is idempotent, and the decision is always to write.
    return [];
  }

  async write(record: WantedRecord): Promise<string | null> {
    // DuckDNS holds an IPv4 and an IPv6 address for a subdomain, and nothing else.
    if (record.kind === "SRV") throw new PlatformError("DNS_PROVIDER_FAILED", "DuckDNS cannot hold an SRV record.");
    // The name's subdomain, not the name: every name under a subdomain answers with its address.
    const sub = duckBase(record.name);
    if (!sub) throw new PlatformError("DNS_PROVIDER_FAILED", `${record.name} is not under a duckdns.org subdomain.`);
    const family: AddressFamily = record.kind;
    await this.update(sub, family === "A" ? { ip: record.content } : { ipv6: record.content });
    return null;
  }

  /* DuckDNS can clear a subdomain and cannot clear one family of it: `clear=true` takes both addresses away.
     So removing one of two is a removal of both, and the caller writes back the one it meant to keep. */
  async remove(record: { kind: RecordKind; name: string }): Promise<void> {
    const sub = duckBase(record.name);
    if (!sub) return;
    await this.update(sub, { clear: "true" });
  }
}
