/* The address a node says the panel can reach it at, judged when it registers.

   The panel calls that address for as long as the node exists, with the node's token in the Authorization header, and
   shows what comes back in its own words. Whoever holds a registration token chooses it. Most addresses are fine: a
   node on the same machine, on the LAN, behind a name — a private or loopback address is exactly what a panel and a
   node on one host use, so those are not refused. What is refused is what no node ever has and a request to which
   can only be an attempt to reach something else with the panel's credentials: the cloud provider's metadata service,
   a link-local address, an address with a name and password written into it, and an address that is nobody's. */

const METADATA_NAMES = new Set(["metadata.google.internal", "metadata", "instance-data", "instance-data.ec2.internal"]);

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

/** A sentence for the person who ran the join, or null when the address is acceptable. */
export function advertisedUrlProblem(url: URL): string | null {
  if (url.username || url.password) {
    return "An address with a user name or password written into it is not one the panel will call. Use a plain address and port.";
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return "That address has no host in it.";
  if (METADATA_NAMES.has(host)) return "That is the cloud provider's metadata service, not a node.";

  const v4 = ipv4Octets(host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 169 && b === 254) return "169.254.0.0/16 is link-local, which includes the cloud metadata service. A node is not at one.";
    if (a === 0) return "0.0.0.0/8 is not an address a node can be at.";
    if (a >= 224) return "That is a multicast or reserved address, not a node's.";
    return null;
  }

  // IPv6, written the usual ways: the host is hex groups with colons, and may carry an IPv4 tail.
  if (host.includes(":")) {
    if (/^fe[89ab]/.test(host)) return "fe80::/10 is link-local. A node is not at one.";
    if (host === "::" || host === "0:0:0:0:0:0:0:0") return "That is the unspecified address, not a node's.";
    if (/^fd00:ec2:/.test(host)) return "That is the cloud metadata service's address, not a node's.";
    if (/^ff/.test(host)) return "That is a multicast address, not a node's.";
    /* IPv4 inside IPv6. A URL parser writes it as two hex groups (::ffff:a9fe:a9fe), and a hand-written one may have the
       dotted tail; both are the address they say. */
    const dotted = /^(?:0{0,4}:){0,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    const hex = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    const inner = dotted ? ipv4Octets(dotted[1]!) : hex ? [parseInt(hex[1]!, 16) >> 8, parseInt(hex[1]!, 16) & 255] : null;
    if (inner && inner[0] === 169 && inner[1] === 254) return "That is an IPv4 link-local address in another spelling, which includes the cloud metadata service.";
  }
  return null;
}
