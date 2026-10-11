/* The channel between the panel and a node, and what it is when the node is somewhere else.

   An agent before 0.11 is called over plain http, with one bearer token. Between two machines on a LAN, or on a private
   network (WireGuard, Tailscale), that is a wire nobody else is on. Across the internet it is not: the token, every console line
   and every file cross it unencrypted, and whoever can watch the path can take over every container on the node through the
   Docker socket. A rule about who may connect to the port does not protect the path. An agent of 0.11 is called over https at
   the same address, pinned to the certificate it registered with (lib/agent-tls.ts), which is what the command the dialog writes
   installs; the address keeps its http either way.

   So an address that is plain http and public is said, when it is typed: what it means for an older agent, and that a current
   one is not affected. Not refused: it is the owner's network. */

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
  "This address is plain http across the internet. An agent of 0.11 or later, which this command installs, is called over https at it, pinned to its own certificate. An older one is not: the token, the console and every file would cross it unencrypted, and whoever can watch the path could take over every container on the node. For one of those, put the node and this panel on a private network (WireGuard, Tailscale) and use the node's address on it.";
