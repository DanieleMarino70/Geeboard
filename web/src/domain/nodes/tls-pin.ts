/* When the panel pins an agent's certificate, and when a new one sends the node back to a person.

   An agent of 0.11 serves https on its port with a certificate of its own and sends the certificate's SHA-256 with the feature `tls`
   (daemon/src/tls.ts, daemon/src/contract.ts). The panel keeps it with the node and calls that node only over https, and only to that
   certificate (lib/agent-tls.ts). Pure, so each rule is a unit test; node-ops.ts applies them at registration and on a heartbeat.

   Registration is where a pin is set or changed, because registration is what a person did: a single-use token from the panel, run on
   the machine. A changed certificate is treated like a changed address (node-ops.ts, registerNode): the node is kept, and goes back to
   waiting for approval, because "the same name, answering with a different key" is also what somebody holding a leaked token would
   produce. So is an agent that stops offering https after one that did: the panel would go back to sending the token in the clear.

   A heartbeat may set a pin only where there is none: a node joined by an agent before 0.11 and upgraded since, which would otherwise
   need joining again to get off plain http. The heartbeat is authenticated by the node's own token, which is everything a pin protects,
   so it adds no way in; and it never replaces a pin, which only a registration does. */

/** 64 lowercase hexadecimal digits: a SHA-256, as the agent sends it and the column keeps it. */
const SHA256 = /^[0-9a-f]{64}$/;

/** A fingerprint as an agent sent it (bare, `sha256:` in front, colons between bytes, either case), or null for anything else. */
export function cleanFingerprint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/^sha256:/, "").replace(/:/g, "");
  return SHA256.test(value) ? value : null;
}

/** How a fingerprint is shown to a person: the first twelve digits, enough to compare with the agent's log by eye. */
export function shortFingerprint(fingerprint: string): string {
  return `sha256:${fingerprint.slice(0, 12)}…`;
}

export interface Offer {
  /** What the agent said it does; `tls` is the feature. */
  features?: unknown;
  /** The certificate's SHA-256 as the agent sent it. */
  tlsFingerprint?: unknown;
}

/* The fingerprint an agent offers to be pinned to, or null. Only for an address that is plain http: an https address is TLS that
   somebody put in front of the agent (a proxy with a certificate of its own), and the agent's certificate is not the one the panel would
   be shown there. */
export function offeredPin(offer: Offer, address: string): string | null {
  if (!Array.isArray(offer.features) || !offer.features.includes("tls")) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  return cleanFingerprint(offer.tlsFingerprint);
}

export type PinChange = "kept" | "first" | "replaced" | "dropped" | "none";

/* What a registration does to the pin: the one it leaves, and what happened to it. `replaced` and `dropped` take an approved node back to
   waiting for a person; `first` is a node that had none, joined or rejoined by an agent that offers one, and keeps its approval. */
export function pinAtRegistration(pinned: string | null, offered: string | null): { pin: string | null; change: PinChange } {
  if (pinned === null) return { pin: offered, change: offered ? "first" : "none" };
  if (offered === pinned) return { pin: pinned, change: "kept" };
  return { pin: offered, change: offered ? "replaced" : "dropped" };
}

/** Whether a registration's change to the pin needs a person to approve the node again. */
export function pinNeedsApproval(change: PinChange): boolean {
  return change === "replaced" || change === "dropped";
}

/** The channel to a node, in the words the activity log and the node's page use. */
export function channelWords(pin: string | null): string {
  return pin ? `https, pinned ${shortFingerprint(pin)}` : "plain http";
}

/** The pin a heartbeat sets, or null to leave the node as it is: only a first one. */
export function pinFromHeartbeat(pinned: string | null, offered: string | null): string | null {
  return pinned === null && offered !== null ? offered : null;
}
