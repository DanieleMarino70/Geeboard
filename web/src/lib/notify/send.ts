import { discordBody, signBody, webhookPayload, type NotificationMessage } from "../../domain/notify/format";
import {
  judgeAddresses,
  judgeUrl,
  policyFromEnvironment,
  type DestinationKind,
  type DestinationPolicy,
} from "../../domain/notify/destination";
import { GuardedFailure, GuardedRefusal, guardedFetch, type GuardedOptions } from "../net/guarded-fetch";
import { PANEL_VERSION } from "../version";

/* The one place the panel calls out to an address somebody pasted.

   Everything that could go wrong with that is decided before and around the
   call and not inside it: the address is judged (domain/notify/destination.ts),
   every address its host resolves to is judged again, and the call goes to one
   of those and nowhere else, with no redirect (lib/net/guarded-fetch.ts). What
   comes back is read for its status and nothing more; no part of the answer is
   kept or shown, because a receiver's answer is the one thing in this exchange
   that somebody else wrote.

   What this says about a failure is a fixed phrase and the host's name, never
   the address that was tried, the path of the webhook (which holds a token), or
   what the receiver replied. */

export interface Channel {
  kind: DestinationKind;
  /** Decrypted. */
  url: string;
  /** Decrypted; a webhook signs its body with it. */
  signingSecret: string | null;
}

export type SendResult =
  | { ok: true; status: number }
  /** `retry` is whether trying again later could help: a service that is down, yes; a webhook that was deleted, no. */
  | { ok: false; reason: string; retry: boolean };

export interface SendOptions {
  policy?: DestinationPolicy;
  /** Tests only: the call itself, so what would have been sent can be read. */
  call?: (url: URL, options: GuardedOptions) => Promise<Response>;
  /** Tests only: how a name becomes addresses. */
  resolve?: GuardedOptions["resolve"];
  timeoutMs?: number;
  now?: () => number;
}

const USER_AGENT = `Geeboard/${PANEL_VERSION}`;

export async function sendNotification(channel: Channel, message: NotificationMessage, options: SendOptions = {}): Promise<SendResult> {
  const policy = options.policy ?? policyFromEnvironment();
  const verdict = judgeUrl(channel.kind, channel.url, policy);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, retry: false };

  const body = JSON.stringify(channel.kind === "DISCORD" ? discordBody(message) : webhookPayload(message));
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": USER_AGENT };
  if (channel.kind === "WEBHOOK") {
    const timestamp = Math.floor((options.now?.() ?? Date.now()) / 1000);
    headers["x-geeboard-event"] = message.kind;
    headers["x-geeboard-timestamp"] = String(timestamp);
    if (channel.signingSecret) headers["x-geeboard-signature"] = signBody(channel.signingSecret, timestamp, body);
  }

  try {
    const res = await (options.call ?? guardedFetch)(verdict.url, {
      method: "POST",
      headers,
      body,
      timeoutMs: options.timeoutMs ?? 5_000,
      maxBytes: 2048,
      judge: (addresses) => judgeAddresses(channel.kind, addresses, policy, verdict.plainHttp),
      ...(options.resolve ? { resolve: options.resolve } : {}),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, reason: `${verdict.host} answered with a redirect, which the panel does not follow. Use the address it redirects to.`, retry: false };
    }
    // 429 is the service asking for patience, and a 5xx is the service having a bad moment: both are worth another try.
    const retry = res.status === 429 || res.status >= 500;
    return {
      ok: false,
      reason: `${verdict.host} answered HTTP ${res.status}${res.status === 404 ? ", which for a webhook usually means it was deleted" : ""}.`,
      retry,
    };
  } catch (error) {
    if (error instanceof GuardedRefusal) return { ok: false, reason: error.message, retry: false };
    const phrase = error instanceof GuardedFailure ? error.message : "could not be reached";
    return { ok: false, reason: `${verdict.host} ${phrase}.`, retry: true };
  }
}
