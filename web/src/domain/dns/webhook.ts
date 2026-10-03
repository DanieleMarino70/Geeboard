import { createHash } from "node:crypto";
import type { RecordKind, WantedRecord } from "./rules";

/* What the panel says to a DNS webhook, and what it makes of the answer. Pure:
   nothing here calls anybody. lib/dns/webhook.ts sends what this builds, under
   the same rules as a notification webhook (domain/notify/destination.ts),
   and docs/dns-webhook.md is the receiver's side of it.

   The panel cannot ask a receiver what is at a name, so it does not pretend
   to: it says what it wants set and what it wants removed, each of them
   something that can be said twice. A record is identified by its type and its
   name, so "set" is the whole record that should be there and "remove" is
   whatever is there, and neither depends on what came before. That is what
   makes a retry safe, and what lets a poller that does not know whether the
   last call arrived simply make it again. */

export type WebhookEvent = "dns.test" | "dns.set" | "dns.remove";

export const WEBHOOK_TTL = 60;

export interface SrvFields {
  priority: number;
  weight: number;
  port: number;
  target: string;
}

export interface SetBody {
  event: "dns.set";
  zone: string;
  record: {
    type: RecordKind;
    name: string;
    /** An address, or for SRV `priority weight port target`. */
    content: string;
    ttl: number;
    /** What the panel marks its own records with; a receiver that keeps records of other people's can tell these apart. */
    comment: string;
    /** For an SRV, the four fields of its content, so a receiver does not have to split a string. */
    srv?: SrvFields;
  };
  sentAt: string;
}

export interface RemoveBody {
  event: "dns.remove";
  zone: string;
  record: { type: RecordKind; name: string };
  sentAt: string;
}

export interface TestBody {
  event: "dns.test";
  zone: string;
  sentAt: string;
}

export type WebhookBody = SetBody | RemoveBody | TestBody;

/** An SRV record's content as its four fields; null when it is not four of them. */
export function parseSrv(content: string): SrvFields | null {
  const parts = content.trim().split(/\s+/);
  if (parts.length !== 4) return null;
  const [priority, weight, port, target] = [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts[3]!];
  if (![priority, weight, port].every((n) => Number.isInteger(n) && n >= 0 && n <= 65535) || !target) return null;
  return { priority, weight, port, target: target.replace(/\.$/, "") };
}

export function setBody(zone: string, record: WantedRecord, marker: string, at: Date): SetBody {
  const srv = record.kind === "SRV" ? parseSrv(record.content) : null;
  return {
    event: "dns.set",
    zone,
    record: { type: record.kind, name: record.name, content: record.content, ttl: WEBHOOK_TTL, comment: marker, ...(srv ? { srv } : {}) },
    sentAt: at.toISOString(),
  };
}

export function removeBody(zone: string, record: { kind: RecordKind; name: string }, at: Date): RemoveBody {
  return { event: "dns.remove", zone, record: { type: record.kind, name: record.name }, sentAt: at.toISOString() };
}

export function testBody(zone: string, at: Date): TestBody {
  return { event: "dns.test", zone, sentAt: at.toISOString() };
}

/* An identifier that is the same for the same thing said again: made of what is
   asked and not of when. A receiver that has already done what a delivery says
   may answer 2xx without doing it twice; the panel never relies on that, since
   every request can be said twice without harm, but a receiver that logs, or
   that talks to a slow API, can. A signature and a timestamp are not this: they
   change with every attempt. */
export function deliveryId(body: WebhookBody): string {
  const parts =
    body.event === "dns.set"
      ? [body.event, body.record.type, body.record.name, body.record.content]
      : body.event === "dns.remove"
        ? [body.event, body.record.type, body.record.name]
        : [body.event];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

export type Outcome =
  | { ok: true }
  /* `refused` is the receiver saying it does not trust the panel's signature, which is the secret being wrong and not a
     bad moment; everything else that is not a success is a failure, and the poller's retry covers it. */
  | { ok: false; code: "DNS_TOKEN_REFUSED" | "DNS_PROVIDER_FAILED"; message: string };

/* What a receiver's HTTP status means, in a fixed phrase: its words are never
   kept or shown, because they are the one thing in the exchange that somebody
   else wrote. Removing what is not there is removed, so a receiver may answer
   404 or 410 to a remove. */
export function judgeStatus(event: WebhookEvent, status: number): Outcome {
  if (status >= 200 && status < 300) return { ok: true };
  if (event === "dns.remove" && (status === 404 || status === 410)) return { ok: true };
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "DNS_TOKEN_REFUSED",
      message: `The receiver refused the panel's signature (HTTP ${status}). Check that it holds the secret this webhook was set up with.`,
    };
  }
  if (status >= 300 && status < 400) {
    return { ok: false, code: "DNS_PROVIDER_FAILED", message: `The receiver answered with a redirect (HTTP ${status}), which the panel does not follow. Use the address it redirects to.` };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { ok: false, code: "DNS_PROVIDER_FAILED", message: `The receiver answered HTTP ${status}: it could not take the record just now.` };
  }
  return {
    ok: false,
    code: "DNS_PROVIDER_FAILED",
    message: event === "dns.test" ? `The receiver answered HTTP ${status} to the test.` : `The receiver refused this record (HTTP ${status}).`,
  };
}

/** A secret the panel accepts for signing: not a short word, and nothing that would be cut in a header or a shell. */
export function judgeSigningSecret(value: string): string | null {
  if (value.length < 16) return "A signing secret is at least 16 characters. Make one with the button.";
  if (value.length > 200) return "That secret is too long.";
  if (/\s/.test(value)) return "A signing secret has no spaces.";
  return null;
}
