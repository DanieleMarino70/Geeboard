import "server-only";
import { PlatformError } from "@/domain/errors";
import type { AddressFamily, DnsRecord } from "@/domain/dns/rules";
import { logger } from "../log";
import { askProvider, type DnsClient } from "./provider";

/* Cloudflare, through its v4 API with an API token. The token needs
   Zone:Read and DNS:Edit on the zone, and nothing else; the probe
   proves both by reading the zone and writing and removing a TXT
   record under it. Records are written unproxied — the proxy carries
   web traffic, not a game's ports — with a 60-second TTL and a comment
   naming the server, which is how the panel knows a record as its own.

   The base URL is a variable only so the verify script can stand a
   fake Cloudflare up on a local port. */
const BASE = process.env.CLOUDFLARE_API_BASE?.replace(/\/$/, "") || "https://api.cloudflare.com/client/v4";
const TTL = 60;

interface Envelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

export class CloudflareClient implements DnsClient {
  readonly kind = "cloudflare" as const;

  constructor(
    readonly zone: string,
    private readonly token: string,
    private zoneId: string | null,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await askProvider("Cloudflare", `${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let envelope: Envelope<T> | null = null;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      envelope = null;
    }
    if (response.status === 401 || response.status === 403) {
      logger.warn("cloudflare refused the token", { status: response.status });
      throw new PlatformError("DNS_TOKEN_REFUSED", "Cloudflare refused the API token: revoked, mistyped, or without Zone:Read and DNS:Edit on this zone.");
    }
    if (!response.ok || !envelope?.success) {
      const said = envelope?.errors?.map((e) => `${e.message} (${e.code})`).join("; ") || `answered ${response.status}`;
      logger.warn("cloudflare call refused", { status: response.status, said });
      throw new PlatformError("DNS_PROVIDER_FAILED", `Cloudflare ${envelope?.errors?.length ? "said: " : ""}${said}.`);
    }
    return envelope.result;
  }

  private async zoneIdOf(): Promise<string> {
    if (this.zoneId) return this.zoneId;
    const zones = await this.call<Array<{ id: string; name: string }>>("GET", `/zones?name=${encodeURIComponent(this.zone)}`);
    const match = zones.find((z) => z.name.toLowerCase() === this.zone.toLowerCase());
    if (!match) throw new PlatformError("DNS_TOKEN_REFUSED", `Cloudflare has no zone ${this.zone} that this token can read.`);
    this.zoneId = match.id;
    return match.id;
  }

  async probe(): Promise<{ zoneId: string }> {
    const status = await this.call<{ status: string }>("GET", "/user/tokens/verify");
    if (status.status !== "active") throw new PlatformError("DNS_TOKEN_REFUSED", `Cloudflare says the token is ${status.status}.`);
    this.zoneId = null;
    const zoneId = await this.zoneIdOf();
    /* DNS:Edit cannot be read off the token; it is proved by using it,
       on a record nothing resolves and nothing keeps. */
    const name = `_geeboard-check.${this.zone}`;
    const made = await this.call<{ id: string }>("POST", `/zones/${zoneId}/dns_records`, {
      type: "TXT",
      name,
      content: `"geeboard check ${new Date().toISOString()}"`,
      ttl: TTL,
      comment: "geeboard:check",
    });
    await this.call("DELETE", `/zones/${zoneId}/dns_records/${made.id}`);
    return { zoneId };
  }

  async read(host: string): Promise<DnsRecord[]> {
    const zoneId = await this.zoneIdOf();
    const rows = await this.call<Array<{ id: string; type: string; name: string; content: string; comment?: string | null }>>(
      "GET",
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(host)}&per_page=100`,
    );
    return rows.map((r) => ({ id: r.id, type: r.type, name: r.name, content: r.content, comment: r.comment ?? null }));
  }

  async write(host: string, family: AddressFamily, address: string, marker: string, id: string | null): Promise<string> {
    const zoneId = await this.zoneIdOf();
    const body = { type: family, name: host, content: address, ttl: TTL, proxied: false, comment: marker };
    const made = id
      ? await this.call<{ id: string }>("PUT", `/zones/${zoneId}/dns_records/${id}`, body)
      : await this.call<{ id: string }>("POST", `/zones/${zoneId}/dns_records`, body);
    return made.id;
  }

  async remove(host: string, id: string | null): Promise<void> {
    const zoneId = await this.zoneIdOf();
    let target = id;
    if (!target) {
      // A record adopted or written before its id was kept: find it by name, ours only.
      const ours = (await this.read(host)).find((r) => (r.type === "A" || r.type === "AAAA") && r.id);
      target = ours?.id ?? null;
    }
    if (!target) return;
    await this.call("DELETE", `/zones/${zoneId}/dns_records/${target}`);
  }
}
