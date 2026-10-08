import { isIPv4, isIPv6 } from "node:net";

/* What kind of place an IP address is, for deciding whether the panel may
   call it on somebody's say-so.

   `domain/dns/rules.ts` already says whether an address is public, and its
   answer is a yes or a no: right for "is this worth a DNS record". It is
   not enough for "may the panel call this", where the reason matters —
   a private network is a thing an operator may choose to allow, the
   address a cloud keeps its credentials at is a thing nobody may. So this
   names the class, and the policy that reads it lives with whoever is
   asking (domain/notify/destination.ts).

   Addresses that carry another address inside them are judged by what they
   carry. `::ffff:127.0.0.1` is the loopback address however it is spelled,
   and a NAT64 or 6to4 address is the IPv4 address a gateway would forward
   to; a check that looked only at the outside would let all of them through.

   Documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24,
   2001:db8::/32) are public here, as they are in `isPublicAddress`: nothing
   routes them, and the examples in the documentation and the tests use
   them as stand-ins for "somewhere out there". */

export type AddressClass =
  | "public"
  /** RFC 1918, carrier-grade NAT, unique-local IPv6: somebody's own network. */
  | "private"
  /** 127.0.0.0/8 and ::1: the machine itself. */
  | "loopback"
  /** 169.254.0.0/16 and fe80::/10, where a cloud's metadata service answers. */
  | "link-local"
  /** IPv6 addresses a cloud's metadata service uses that are not link-local (AWS: fd00:ec2::254). */
  | "metadata"
  | "unspecified"
  | "multicast"
  /** 240.0.0.0/4, the broadcast address, and the like. */
  | "reserved";

/** "A" for an IPv4 literal, "AAAA" for IPv6, null for anything else. Strict: no leading zeros, no shorthand. */
export function literalFamily(value: string): "A" | "AAAA" | null {
  const v = value.trim();
  if (isIPv4(v)) return "A";
  if (isIPv6(v)) return "AAAA";
  return null;
}

function v4Parts(value: string): [number, number, number, number] {
  const p = value.split(".").map(Number);
  return [p[0]!, p[1]!, p[2]!, p[3]!];
}

function classifyV4([a, b, c, d]: [number, number, number, number]): AddressClass {
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  /* Other clouds keep theirs at an address of their own: Alibaba at 100.100.100.200 (inside the carrier-grade NAT range below), Azure's wire
     server at 168.63.129.16, and Oracle's is reported at 192.0.0.192 inside the IETF protocol block. The audit of 0.9.5 measured all three
     as ordinary addresses. */
  if (a === 100 && b === 100 && c === 100 && d === 200) return "metadata";
  if (a === 168 && b === 63 && c === 129 && d === 16) return "metadata";
  if (a === 192 && b === 0 && c === 0) return d === 192 ? "metadata" : "reserved"; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return "private"; // 198.18.0.0/15, benchmarking: somebody's own network, never the internet
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // carrier-grade NAT
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved"; // 240.0.0.0/4, which holds the broadcast address
  return "public";
}

/** An IPv6 literal as eight 16-bit groups, or null when it is not one. Handles `::` and an IPv4 tail. */
function v6Groups(value: string): number[] | null {
  let v = value.trim().toLowerCase();
  const zone = v.indexOf("%");
  if (zone !== -1) v = v.slice(0, zone);
  if (!isIPv6(v)) return null;

  // An embedded IPv4 tail (::ffff:1.2.3.4) is two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (tail) {
    const [a, b, c, d] = v4Parts(tail[2]!);
    v = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v4Of(high: number, low: number): [number, number, number, number] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function classifyV6(g: number[]): AddressClass {
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (zeroTo(7) && g[7] === 0) return "unspecified";
  if (zeroTo(7) && g[7] === 1) return "loopback";

  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible form (::a.b.c.d): judged as the IPv4 address inside.
  if (zeroTo(5) && g[5] === 0xffff) return classifyV4(v4Of(g[6]!, g[7]!));
  if (zeroTo(6)) return classifyV4(v4Of(g[6]!, g[7]!));
  // SIIT (::ffff:0:a.b.c.d, ::ffff:0:0:0/96): the translated form of the same, with the IPv4 address in the last 32 bits.
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return classifyV4(v4Of(g[6]!, g[7]!));
  // NAT64 (64:ff9b::/96): a gateway forwards it to the IPv4 address in the last 32 bits.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return classifyV4(v4Of(g[6]!, g[7]!));
  // The local-use NAT64 prefix (64:ff9b:1::/48, RFC 8215): the same, for a gateway an operator runs.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return classifyV4(v4Of(g[6]!, g[7]!));
  // 6to4 (2002::/16): the IPv4 address is in the next 32 bits.
  if (g[0] === 0x2002) return classifyV4(v4Of(g[1]!, g[2]!));

  if ((g[0]! & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return "private"; // fec0::/10, site-local: deprecated, and still not somewhere to send a request
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return "metadata"; // AWS's IPv6 metadata service, which sits in unique-local space
  if ((g[0]! & 0xfe00) === 0xfc00) return "private"; // fc00::/7
  if ((g[0]! & 0xff00) === 0xff00) return "multicast";
  return "public";
}

/** The class of an IP literal, or null when the value is not one (a name, say, which has to be resolved first). */
export function classifyAddress(value: string): AddressClass | null {
  const v = value.trim().replace(/^\[|\]$/g, "");
  const family = literalFamily(v);
  if (family === "A") return classifyV4(v4Parts(v));
  if (family === "AAAA") {
    const groups = v6Groups(v);
    return groups ? classifyV6(groups) : null;
  }
  return null;
}
