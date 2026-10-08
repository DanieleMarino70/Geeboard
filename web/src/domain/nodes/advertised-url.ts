import { classifyAddress } from "../net/address";

/* The address a node says the panel can reach it at, judged when it registers.

   The panel calls that address for as long as the node exists, with the node's token in the Authorization header, and
   shows what comes back in its own words. Whoever holds a registration token chooses it. Most addresses are fine: a
   node on the same machine, on the LAN, behind a name — a private or loopback address is exactly what a panel and a
   node on one host use, so those are not refused. What is refused is what no node ever has and a request to which
   can only be an attempt to reach something else with the panel's credentials: the cloud provider's metadata service,
   a link-local address, an address with a name and password written into it, and an address that is nobody's. */

const METADATA_NAMES = new Set(["metadata.google.internal", "metadata.goog", "metadata", "instance-data", "instance-data.ec2.internal"]);

/** A sentence for the person who ran the join, or null when the address is acceptable. */
export function advertisedUrlProblem(url: URL): string | null {
  if (url.username || url.password) {
    return "An address with a user name or password written into it is not one the panel will call. Use a plain address and port.";
  }
  // A name with a dot at its end is the same name, and an exact match on the list would miss it (the audit of 0.9.5).
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host) return "That address has no host in it.";
  if (METADATA_NAMES.has(host)) return "That is the cloud provider's metadata service, not a node.";


  /* An address written out is judged by the one classifier the panel uses wherever it decides whether it may call something
     (domain/net/address.ts), which reads IPv4 hidden in IPv6 by what it carries. This used to be a second, hand-written filter, and
     `[::a9fe:a9fe]`, `[64:ff9b::a9fe:a9fe]` and `[2002:a9fe:a9fe::]` were all the metadata address and all accepted. A name is not
     resolved here: whoever registers a node chooses where it is, and a name is the operator's business (docs/security.md). */
  const kind = classifyAddress(host);
  switch (kind) {
    case "link-local":
      return host.includes(":")
        ? "That is a link-local address (or an IPv4 link-local one written in IPv6), which includes the cloud metadata service. A node is not at one."
        : "169.254.0.0/16 is link-local, which includes the cloud metadata service. A node is not at one.";
    case "metadata":
      return "That is a cloud metadata service's address, not a node's.";
    case "unspecified":
      return host.includes(":") ? "That is the unspecified address, not a node's." : "0.0.0.0/8 is not an address a node can be at.";
    case "multicast":
    case "reserved":
      return "That is a multicast or reserved address, not a node's.";
    default:
      return null;
  }
}
