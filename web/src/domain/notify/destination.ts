import { classifyAddress, type AddressClass } from "../net/address";

/* Where a notification may be sent, and what to say when it may not.

   A webhook is an address a person types, and the panel calls it from
   inside its own network, where the database, the agent on 127.0.0.1 and —
   on a VPS — the cloud's metadata service answer. So "a person may type
   any address" is not an option, and the rules are the whole of the
   security of this feature:

     Discord     only what Discord itself issues:
                 https://discord.com/api/webhooks/<id>/<token>. Nothing
                 else is a Discord webhook, and no lookup is trusted for it
                 either: whatever it resolves to has to be public.
     webhook     https, to an address that is public. A name is resolved
                 by the panel, every address it gives is judged, and the
                 call goes to one of those addresses and not to a second
                 lookup — see lib/net/guarded-fetch.ts.

   One thing the operator may allow, from the machine and never from the
   page: GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1 lets a webhook reach private
   networks (RFC 1918, carrier-grade NAT, unique-local IPv6) and, there, use
   plain http — for ntfy, Gotify, Home Assistant. Whatever the setting, these
   are never reachable: the machine itself, link-local addresses where cloud
   metadata answers, and the unspecified, multicast and reserved ranges.

   This file is pure: a URL and a policy in, a verdict out. Resolving names
   and making the call are somebody else's, and they hand every address they
   find back here before using any of them. */

export type DestinationKind = "DISCORD" | "WEBHOOK";

export interface DestinationPolicy {
  /** The operator's consent to private networks, from the environment. */
  allowPrivate: boolean;
  /**
   * Tests only: lets the machine itself be called, so a stand-in can listen
   * on 127.0.0.1. Nothing reads this from the environment, a setting or a
   * request; it exists as a parameter and the production call never passes it.
   */
  allowLoopback?: boolean;
}

export const PRIVATE_NETWORKS_VARIABLE = "GEEBOARD_WEBHOOK_ALLOW_PRIVATE";

/** The policy the operator set, from the environment. Anything but a plain yes is a no. */
export function policyFromEnvironment(env: Record<string, string | undefined> = process.env): DestinationPolicy {
  return { allowPrivate: /^(1|true|on|yes)$/i.test((env[PRIVATE_NETWORKS_VARIABLE] ?? "").trim()) };
}

export type UrlVerdict =
  | {
      ok: true;
      url: URL;
      /** The host, for the page: never the path, which holds the token. */
      host: string;
      /** The address, when the host is one and not a name. Already judged. */
      literal: string | null;
      /** http, allowed only to a private network: every address must then be private. */
      plainHttp: boolean;
    }
  | { ok: false; reason: string };

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"]);
const DISCORD_PATH = /^\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})$/;
const MAX_LENGTH = 2048;

export const DISCORD_SHAPE = "https://discord.com/api/webhooks/<id>/<token>";

function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

const CLASS_WORDS: Record<AddressClass, string> = {
  public: "a public address",
  private: "a private network address",
  loopback: "this machine's own address",
  "link-local": "a link-local address, where cloud metadata answers",
  metadata: "a cloud metadata address",
  unspecified: "an address that means nothing",
  multicast: "a multicast address",
  reserved: "a reserved address",
};

/** Whether an address of this class may be called, as a sentence when not. Null means yes. */
export function refusalForClass(kind: DestinationKind, cls: AddressClass, policy: DestinationPolicy, plainHttp = false): string | null {
  if (cls === "public") {
    return plainHttp ? "Plain http is allowed only to a private network, and this is a public address. Use https." : null;
  }
  if (cls === "loopback") {
    return policy.allowLoopback === true ? null : "That is this machine's own address, which a webhook may never call. Use the address of another machine.";
  }
  if (cls === "private") {
    if (kind === "DISCORD") return "A Discord webhook is a public address; this is a private network address.";
    if (policy.allowPrivate) return null;
    return `That is a private network address. A webhook may call only public addresses, unless the person who runs the panel allows private networks with ${PRIVATE_NETWORKS_VARIABLE}=1 on the machine.`;
  }
  return `That is ${CLASS_WORDS[cls]}, which a webhook may never call.`;
}

/**
 * Whether every address a name resolved to may be called. One that may not
 * refuses the lot: a name that answers with a public address and a private
 * one is the way a check is walked around, not a case to choose from.
 */
export function judgeAddresses(
  kind: DestinationKind,
  addresses: readonly string[],
  policy: DestinationPolicy,
  plainHttp = false,
): { ok: true } | { ok: false; reason: string } {
  if (addresses.length === 0) return refuse("That name does not resolve to any address.");
  for (const address of addresses) {
    const cls = classifyAddress(address);
    if (cls === null) return refuse("That name resolved to something that is not an address.");
    const reason = refusalForClass(kind, cls, policy, plainHttp);
    if (reason) return refuse(reason);
  }
  return { ok: true };
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * The first judgement, on the text of an address and before anything is
 * resolved or called: is it the right shape, to the right kind of place.
 * A host that is an address already is judged here, and a name is left for
 * the caller to resolve and hand to `judgeAddresses`.
 */
export function judgeUrl(kind: DestinationKind, raw: string, policy: DestinationPolicy): UrlVerdict {
  const text = raw.trim();
  if (!text) return refuse("Paste the address of the webhook.");
  if (text.length > MAX_LENGTH) return refuse("That address is too long to be a webhook.");

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse("That does not look like an address. It starts with https://.");
  }
  if (url.username || url.password) {
    return refuse("The address carries a user name or password. A webhook's secret belongs in its path, not in a login.");
  }
  if (url.hash) return refuse("Leave out the part of the address after #.");

  const host = bareHost(url);
  if (!host) return refuse("That address has no host.");

  if (kind === "DISCORD") {
    if (url.protocol !== "https:" || !DISCORD_HOSTS.has(host) || url.port) {
      return refuse(`That is not a Discord webhook address. It looks like ${DISCORD_SHAPE}.`);
    }
    if (!DISCORD_PATH.test(url.pathname)) {
      return refuse(`That is not a Discord webhook address. It looks like ${DISCORD_SHAPE}.`);
    }
    // Discord takes a thread to post in and whether to wait for the answer. Nothing else belongs here.
    for (const [key, value] of url.searchParams) {
      const fine = (key === "thread_id" && /^\d{5,25}$/.test(value)) || (key === "wait" && /^(true|false)$/.test(value));
      if (!fine) return refuse("A Discord webhook address takes no options except thread_id.");
    }
    return { ok: true, url, host, literal: null, plainHttp: false };
  }

  const plainHttp = url.protocol === "http:";
  if (url.protocol !== "https:" && !(plainHttp && policy.allowPrivate)) {
    return refuse(
      plainHttp
        ? `A webhook has to be https. Plain http to a private network is allowed only when the person who runs the panel sets ${PRIVATE_NETWORKS_VARIABLE}=1 on the machine.`
        : "A webhook address has to start with https://.",
    );
  }

  const cls = classifyAddress(host);
  if (cls !== null) {
    const reason = refusalForClass(kind, cls, policy, plainHttp);
    if (reason) return refuse(reason);
    return { ok: true, url, host, literal: host, plainHttp };
  }
  return { ok: true, url, host, literal: null, plainHttp };
}

/** What the page may show of a saved address: where it goes, never the token in it. */
export function describeDestination(kind: DestinationKind, raw: string): string {
  try {
    const url = new URL(raw);
    if (kind === "DISCORD") {
      const id = DISCORD_PATH.exec(url.pathname)?.[1];
      return id ? `${url.hostname}/api/webhooks/${id}/•••` : url.hostname;
    }
    return url.hostname;
  } catch {
    return "an address that cannot be read";
  }
}
