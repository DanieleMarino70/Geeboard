import { classifyAddress, type AddressClass } from "../net/address";

/* Where the panel may send its own requests to a bucket.

   The bucket's address is typed by an owner or an admin, and the panel
   calls it with a signed request from inside its own network. Most of what
   that can reach is the operator's own business: a MinIO on the same
   machine, in the same Docker network, on the same LAN — that is the usual
   way to run this, and refusing it would refuse the setup the project is
   for. What nobody has a reason to point a bucket at is the address a cloud
   keeps the machine's credentials at, and the ranges that mean nothing.

     allowed   a public address, a private network, this machine itself
     refused   link-local (169.254.0.0/16, fe80::/10, where cloud metadata
               answers), cloud metadata addresses outside it, the
               unspecified address, multicast and reserved ranges

   A name is resolved by the caller and every address it gives comes back
   through `judgeBucketAddresses`, as for a webhook (see
   lib/net/guarded-fetch.ts). Webhooks have a stricter rule of their own —
   domain/notify/destination.ts — because there nobody chose the receiver. */

const REFUSED: Partial<Record<AddressClass, string>> = {
  "link-local": "a link-local address, where a cloud's metadata service answers",
  metadata: "a cloud metadata address",
  unspecified: "an address that means nothing",
  multicast: "a multicast address",
  reserved: "a reserved address",
};

export function bucketRefusal(cls: AddressClass): string | null {
  const what = REFUSED[cls];
  return what ? `The bucket's endpoint is ${what}, which the panel will not call. Use the address of the store itself.` : null;
}

export function judgeBucketAddresses(addresses: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (addresses.length === 0) return { ok: false, reason: "The bucket's endpoint does not resolve to any address." };
  for (const address of addresses) {
    const cls = classifyAddress(address);
    if (cls === null) return { ok: false, reason: "The bucket's endpoint resolved to something that is not an address." };
    const reason = bucketRefusal(cls);
    if (reason) return { ok: false, reason };
  }
  return { ok: true };
}

/** The first look, on the text, before anything is resolved: an endpoint that is itself a forbidden address. Null when it may go on. */
export function bucketEndpointProblem(endpoint: URL): string | null {
  const host = endpoint.hostname.replace(/^\[|\]$/g, "");
  const cls = classifyAddress(host);
  return cls === null ? null : bucketRefusal(cls);
}
