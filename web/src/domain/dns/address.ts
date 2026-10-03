import { coveredBy, isPublicAddress, type DnsKind } from "./rules";

/* What the create wizard says about the address somebody typed, from
   what the name resolves to today and what the panel holds: which nodes
   there are and where they can be reached, and whether a DNS provider is
   set. Nothing here resolves a name or reads a database — the lookup is
   lib/address-check.ts's — so the wording can be tested the way the
   decisions beside it are.

   The aim is that nobody creates a server on a name that cannot work
   without knowing it. A name that does not exist, or points at a machine
   that is not one of the nodes, is said so; and where the panel could
   have kept the record itself, that is offered. */

export type Lookup =
  | { kind: "found"; addresses: string[] }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

export interface AddressFacts {
  host: string;
  lookup: Lookup;
  /** Every node, with the addresses a record would point at: one for each family it has, none when it has none to give. */
  nodes: Array<{ name: string; addresses: string[] }>;
  provider: { kind: DnsKind; zone: string } | null;
}

export interface AddressVerdict {
  tone: "success" | "info" | "warning" | "muted";
  title: string;
  body: string;
  /** Suggest setting up a DNS provider: no provider is set, and this name would have been better for one. */
  offerSetup: boolean;
}

export function judgeAddress(facts: AddressFacts): AddressVerdict {
  const { host, lookup, nodes, provider } = facts;
  const found = lookup.kind === "found" ? lookup.addresses : [];
  const matched = nodes.filter((n) => n.addresses.some((a) => found.includes(a)));
  const addressed = nodes.filter((n) => n.addresses.length > 0);
  const today = found.length > 0 ? found.join(", ") : null;

  if (provider && coveredBy(provider.kind, provider.zone, host)) {
    if (addressed.length === 0) {
      return {
        tone: "warning",
        title: "No node has a public address yet",
        body: `${host} is under ${provider.zone}, so Geeboard writes its record — but it has no address to point it at. Set one on a node's page (Configure), or the record waits until it has.`,
        offerSetup: false,
      };
    }
    if (matched.length > 0) {
      return {
        tone: "success",
        title: `Already points at ${matched[0]!.name}`,
        body: `Geeboard keeps the record there, and moves it if the node's address changes.`,
        offerSetup: false,
      };
    }
    if (today) {
      return provider.kind === "cloudflare"
        ? {
            tone: "warning",
            title: "A record already exists at this name",
            body: `${host} points at ${today} today. Geeboard leaves a record it did not make alone, so the server is created and its record is not written until that one is removed — or pick another name under ${provider.zone}.`,
            offerSetup: false,
          }
        : {
            tone: "info",
            title: "Geeboard will point it at the node",
            body: `${host} points at ${today} today. Its subdomain's address is set to the node's when the server is created.`,
            offerSetup: false,
          };
    }
    return {
      tone: "success",
      title: "Geeboard will create this record",
      body:
        provider.kind === "duckdns"
          ? `${host} does not resolve yet, which is right for a new server. Its record is written when the server is created — provided its DuckDNS subdomain is one you made on duckdns.org.`
          : `${host} does not exist yet. Its record is written when the server is created, pointing at the node you choose.`,
      offerSetup: false,
    };
  }

  if (provider) {
    if (matched.length > 0) {
      return {
        tone: "success",
        title: `Points at ${matched[0]!.name}`,
        body: `This name is not under ${provider.zone}, so the record is yours to keep — and it is right.`,
        offerSetup: false,
      };
    }
    return {
      tone: "warning",
      title: `Not under ${provider.zone}`,
      body: today
        ? `${host} points at ${today}, which is not one of your nodes. Geeboard only writes records under ${provider.zone}, so this one is yours to change — or use a name under ${provider.zone} and Geeboard does it.`
        : `${host} does not exist yet. Geeboard only writes records under ${provider.zone}, so create this one yourself at its provider — or use a name under ${provider.zone} and Geeboard does it.`,
      offerSetup: false,
    };
  }

  // No provider: the record is the creator's, and the check says whether it is there.
  if (matched.length > 0) {
    return {
      tone: "success",
      title: `Points at ${matched[0]!.name}`,
      body: "Players can connect with this name as it is.",
      offerSetup: false,
    };
  }
  if (lookup.kind === "failed") {
    return {
      tone: "muted",
      title: "Could not check this name just now",
      body: `${lookup.reason} You can still create the server, and check the name yourself afterwards.`,
      offerSetup: true,
    };
  }
  if (today) {
    const reachable = found.some((a) => isPublicAddress(a));
    return {
      tone: "warning",
      title: `This name points at ${today}`,
      body: reachable
        ? "That is not one of your nodes, so players would reach another machine. Point the record at your node, or let Geeboard keep the record for you."
        : "That is a private address, so only machines on your own network can reach it. Point the record at your node's public address, or let Geeboard keep the record for you.",
      offerSetup: true,
    };
  }
  return {
    tone: "info",
    title: "This name does not exist yet",
    body: "Players cannot join by it until a DNS record points it at your node. Create the record yourself at your domain's provider, or let Geeboard do it for every server.",
    offerSetup: true,
  };
}

/** Every address that belongs to no node-shaped thing is left out; what a lookup failure says, in a sentence. */
export function lookupFailure(code: string | undefined): string {
  switch (code) {
    case "ETIMEOUT":
    case "ETIMEDOUT":
      return "The name server did not answer in time.";
    case "ECONNREFUSED":
      return "The name server refused the question.";
    case "ESERVFAIL":
      return "The name's own name server failed.";
    default:
      return "The lookup failed.";
  }
}
