import type { DnsKind } from "./rules";

/* What somebody has to do, in order, to have the panel keep a server's
   DNS record — one list per provider, so the DNS page can walk them
   through the one they chose. The steps are facts about the providers,
   not about the panel: DuckDNS's API has no call to make a subdomain (its
   specification lists one to update a record and one to update a text
   record, and nothing else), so making one is a step somebody takes on
   duckdns.org; Cloudflare's takes a token and writes records itself, so
   there is nothing to make per server.

   Which steps are ticked comes from what the panel holds, never from a
   timer, and never for a step it cannot see: the first two are outside it,
   and read as done once a token has been accepted, which is the first
   thing that proves them. */

export interface GuideStep {
  title: string;
  body: string;
  link?: { label: string; href: string };
}

export interface ProviderPitch {
  label: string;
  /** One or two sentences: what it is for, and who does what. */
  pitch: string;
  site: string;
}

export const PITCH: Record<DnsKind, ProviderPitch> = {
  duckdns: {
    label: "DuckDNS",
    pitch:
      "Free names ending in .duckdns.org, made for a machine whose address changes, like one at home. You make one name per node on their site, every server gets a name under it, and the panel points it.",
    site: "https://www.duckdns.org",
  },
  cloudflare: {
    label: "Cloudflare",
    pitch:
      "Your own domain, already on Cloudflare. The panel makes each record itself, so there is nothing to prepare per server.",
    site: "https://dash.cloudflare.com",
  },
};

const STEPS: Record<DnsKind, GuideStep[]> = {
  duckdns: [
    {
      title: "Sign in and copy your token",
      body: "duckdns.org signs you in with an account you already have. The token is shown at the top of the page, under your account.",
      link: { label: "Open duckdns.org", href: "https://www.duckdns.org" },
    },
    {
      title: "Make one subdomain per node there",
      body: "Type a name in the box on duckdns.org and add it. The panel cannot do this one for you: DuckDNS has no call for making a subdomain. Every name under it follows it — aurora.myserver.duckdns.org is myserver's address too — so a server needs no subdomain of its own: one per node is enough.",
    },
    {
      title: "Paste the token here, with one of your subdomains",
      body: "The subdomain is only to check the token with: it is written back as it is, or cleared if it has no address yet. Nothing is saved unless DuckDNS accepts it.",
    },
    {
      title: "Give a server an address under it",
      body: "Create a server, or change an existing one's address in its Settings, to your subdomain or any name under it — myserver.duckdns.org, or aurora.myserver.duckdns.org. Its record is written as it is saved and follows the node. Servers on one node share their subdomain; a server on another node needs its own.",
    },
  ],
  cloudflare: [
    {
      title: "Have the domain on Cloudflare",
      body: "The zone has to be active on your Cloudflare account. The panel writes records in it; it never makes a zone or touches nameservers.",
      link: { label: "Open Cloudflare", href: "https://dash.cloudflare.com" },
    },
    {
      title: "Make an API token for that zone",
      body: "My profile → API tokens → Create token. Permissions: Zone → Zone → Read and Zone → DNS → Edit. Zone resources: include only the one zone. Nothing else, and never the global key.",
      link: { label: "Open API tokens", href: "https://dash.cloudflare.com/profile/api-tokens" },
    },
    {
      title: "Paste the token and the zone's name here",
      body: "The zone is the domain itself, like example.com. The check reads it, then writes and removes a text record under it to prove the token can edit. Nothing is saved unless Cloudflare accepts it.",
    },
    {
      title: "Nothing to make first",
      body: "A server whose address is under the zone — aurora.example.com — gets its record as it is created or saved, unproxied, and it follows the node. A record already at that name is adopted if it says the right address, and left alone if it does not.",
    },
  ],
};

export function guideFor(kind: DnsKind): GuideStep[] {
  return STEPS[kind];
}

/* Which steps the panel can tell are done: the first three once a token
   has been accepted (an accepted token is proof of each), the last once
   a server has a record written. */
export function guideDone(facts: { saved: boolean; written: number }): boolean[] {
  return [facts.saved, facts.saved, facts.saved, facts.written > 0];
}
