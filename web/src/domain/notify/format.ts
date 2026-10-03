import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* What a notification looks like on the wire.

   The message is built once (rules.ts decides what is worth saying and how)
   and stored with its delivery, so a retry sends what was meant. Here it
   becomes the two bodies the panel knows how to send: a Discord embed, and a
   JSON document for any other receiver. The JSON is a contract other people
   write code against — docs/notifications.md describes every field — so it
   changes by adding, not by renaming.

   Nothing in a message is a secret and nothing in it is an address of this
   panel's own: it names a server and a node by the names a person gave
   them, says what happened, and may carry a link to the panel when the
   operator told the panel where it lives (PANEL_URL). Never a token, a
   node's address, a path, or what a console printed. */

export type NotificationTone = "danger" | "warning" | "success" | "info";

export interface NotificationMessage {
  /** The event, by the audit log's name or the notifier's own: "server.crashed", "server.update.available", ... */
  kind: string;
  /** When it happened, as ISO 8601. */
  at: string;
  tone: NotificationTone;
  /** One line. */
  title: string;
  /** A sentence or two, plain text. */
  text: string;
  /** What it is about, by name. Any of these may be absent. */
  server?: { name: string; slug: string | null } | null;
  node?: { name: string } | null;
  /** How many events this message stands for, when it is a group. */
  count?: number;
  /** A link to the panel page that explains it, or null where the panel does not know its own address. */
  link?: string | null;
  /** Small extra facts, by label: "Restart", "Exit code". Values are short and plain. */
  details?: Record<string, string>;
}

/* ── Discord ──────────────────────────────────────────────────── */

const COLORS: Record<NotificationTone, number> = {
  danger: 0xe5484d,
  warning: 0xf5a524,
  success: 0x30a46c,
  info: 0x3e63dd,
};

/** Discord reads Markdown in an embed; a server named `[click](http://…)` is a link. Names are text, so they are escaped. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()<>#+\-.!|~@:])/g, "\\$1");
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * The body Discord's webhook takes. `allowed_mentions` is empty on purpose:
 * a server named `@everyone` must not ping a channel, which is a thing
 * anyone who can name a server could otherwise do.
 */
export function discordBody(message: NotificationMessage): Record<string, unknown> {
  const fields = Object.entries(message.details ?? {})
    .slice(0, 10)
    .map(([name, value]) => ({ name: clip(escapeMarkdown(name), 256), value: clip(escapeMarkdown(value), 1024), inline: true }));
  return {
    username: "Geeboard",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: clip(escapeMarkdown(message.title), 256),
        description: clip(escapeMarkdown(message.text), 4000),
        color: COLORS[message.tone],
        timestamp: message.at,
        ...(message.link ? { url: message.link } : {}),
        ...(fields.length > 0 ? { fields } : {}),
        footer: { text: "Geeboard" },
      },
    ],
  };
}

/* ── Webhook ──────────────────────────────────────────────────── */

export interface WebhookPayload {
  event: string;
  at: string;
  tone: NotificationTone;
  title: string;
  text: string;
  server: { name: string; slug: string | null } | null;
  node: { name: string } | null;
  count: number;
  link: string | null;
  details: Record<string, string>;
}

export function webhookPayload(message: NotificationMessage): WebhookPayload {
  return {
    event: message.kind,
    at: message.at,
    tone: message.tone,
    title: message.title,
    text: message.text,
    server: message.server ?? null,
    node: message.node ?? null,
    count: message.count ?? 1,
    link: message.link ?? null,
    details: message.details ?? {},
  };
}

/**
 * The signature a receiver can check: HMAC-SHA256, hex, over the timestamp, a dot
 * and the body exactly as sent. The timestamp is in the signature so that a
 * captured request cannot be replayed later; a receiver should reject one older
 * than a few minutes.
 */
export function signBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** What a receiver does with the header, in the panel's own words: for the tests and the documentation's example. */
export function signatureMatches(secret: string, timestamp: number, body: string, header: string): boolean {
  const expected = Buffer.from(signBody(secret, timestamp, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A fresh signing key for a channel: 32 random bytes as hex, shown once. */
export function newSigningSecret(): string {
  return `gbwh_${randomBytes(32).toString("hex")}`;
}
