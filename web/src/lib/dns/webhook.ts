import "server-only";
import { PlatformError } from "@/domain/errors";
import type { DnsRecord, RecordKind, WantedRecord } from "@/domain/dns/rules";
import { deliveryId, judgeStatus, removeBody, setBody, testBody, type WebhookBody, type WebhookEvent } from "@/domain/dns/webhook";
import { judgeAddresses, judgeUrl, policyFromEnvironment, type DestinationPolicy } from "@/domain/notify/destination";
import { signBody } from "@/domain/notify/format";
import { logger } from "../log";
import { GuardedFailure, GuardedRefusal, guardedFetch, type GuardedOptions } from "../net/guarded-fetch";
import { userAgent } from "@/domain/net/user-agent";
import { ProviderUnreachable, type DnsClient } from "./provider";

/* A DNS provider that is a receiver somebody runs: the panel says "set this
   record" and "remove this one" to an address, signed, and the receiver does
   the writing at whatever DNS it has. docs/dns-webhook.md is its side.

   It goes out under the rules of a notification webhook and no others, since
   it is the same thing — an address a person typed, called from inside the
   panel's network: judged as text, judged again for every address its name
   resolves to, called by number, never redirected, and read for its status
   alone (domain/notify/destination.ts, lib/net/guarded-fetch.ts). The
   receiver's answer is the one thing here somebody else wrote, so no part of it
   is kept or shown: a failure is a fixed phrase and the host, never the path
   (which may hold a token) and never what was replied.

   The timeout is short, five seconds like a notification's. A receiver that is
   down is waited for once per pass and not once per server — see reconcileDns —
   because creating, moving and deleting a server wait on this call. */

export interface WebhookDeps {
  policy?: DestinationPolicy;
  /** Tests only: the call itself, so what would have been sent can be read. */
  call?: (url: URL, options: GuardedOptions) => Promise<Response>;
  /** Tests only: how a name becomes addresses. */
  resolve?: GuardedOptions["resolve"];
  timeoutMs?: number;
  now?: () => Date;
}

const USER_AGENT = userAgent();

export class WebhookClient implements DnsClient {
  readonly kind = "webhook" as const;

  constructor(
    readonly zone: string,
    private readonly url: string,
    private readonly secret: string,
    private readonly deps: WebhookDeps = {},
  ) {}

  /** A signed `dns.test`, which has to be answered with 2xx: proves the address and the secret together. */
  async probe(): Promise<{ zoneId?: string }> {
    await this.send(testBody(this.zone, this.now()));
    return {};
  }

  /** A receiver cannot be asked what is at a name; the provider says so, and the ops do not ask. */
  async read(): Promise<DnsRecord[]> {
    return [];
  }

  async write(record: WantedRecord, marker: string): Promise<string | null> {
    await this.send(setBody(this.zone, record, marker, this.now()));
    return null;
  }

  async remove(record: { kind: RecordKind; name: string }): Promise<void> {
    await this.send(removeBody(this.zone, record, this.now()));
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async send(body: WebhookBody): Promise<void> {
    const policy = this.deps.policy ?? policyFromEnvironment();
    const verdict = judgeUrl("WEBHOOK", this.url, policy);
    if (!verdict.ok) throw new PlatformError("DNS_PROVIDER_FAILED", verdict.reason);

    const text = JSON.stringify(body);
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const event: WebhookEvent = body.event;
    const headers = {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-geeboard-event": event,
      "x-geeboard-timestamp": String(timestamp),
      "x-geeboard-signature": signBody(this.secret, timestamp, text),
      "x-geeboard-delivery": deliveryId(body),
    };

    let res: Response;
    try {
      res = await (this.deps.call ?? guardedFetch)(verdict.url, {
        method: "POST",
        headers,
        body: text,
        timeoutMs: this.deps.timeoutMs ?? 5_000,
        maxBytes: 2048,
        judge: (addresses) => judgeAddresses("WEBHOOK", addresses, policy, verdict.plainHttp),
        ...(this.deps.resolve ? { resolve: this.deps.resolve } : {}),
      });
    } catch (error) {
      if (error instanceof GuardedRefusal) throw new PlatformError("DNS_PROVIDER_FAILED", error.message);
      const phrase = error instanceof GuardedFailure ? error.message : "could not be reached";
      logger.warn("dns webhook call failed", { host: verdict.host, event, reason: phrase });
      throw new ProviderUnreachable(`The receiver at ${verdict.host} ${phrase}.`);
    }
    const outcome = judgeStatus(event, res.status);
    if (!outcome.ok) throw new PlatformError(outcome.code, outcome.message);
  }
}
