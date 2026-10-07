/* The channel between the panel and a node, and what it is when the node is somewhere else.

   The panel calls the agent over plain http, with one bearer token. Between two machines on a LAN, or on a private network
   (WireGuard, Tailscale), that is a wire nobody else is on. Across the internet it is not: the token, every console line and
   every file cross it unencrypted, and whoever can watch the path can take over every container on the node through the
   Docker socket. A rule about who may connect to the port does not protect the path.

   So an address that is plain http and public is said, when it is typed. Not refused: it is the owner's network, and what
   to do about it (a private network on both ends, or TLS in front of the agent) is theirs to arrange. */

import { addressFamily, isPublicAddress } from "../dns/rules";

/** True for `http://` at an address that is not on a private network: a public IP, or a name that is not a LAN's. */
export function plainHttpAcrossTheInternet(advertise: string): boolean {
  let url: URL;
  try {
    url = new URL(advertise.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (addressFamily(host)) return isPublicAddress(host);
  // A name: this machine's, or one a LAN gives out, is on a private network; any other is out there.
  if (host === "localhost" || !host.includes(".")) return false;
  if (/\.(local|lan|internal|home|home\.arpa|localdomain|ts\.net)$/.test(host)) return false;
  return true;
}

export const PLAIN_HTTP_WARNING =
  "This address is plain http across the internet. The token, the console and every file cross it unencrypted, and whoever can watch the path can take over every container on the node. Put the node and this panel on a private network (WireGuard, Tailscale) and use the node's address on it, or put TLS in front of the agent.";
