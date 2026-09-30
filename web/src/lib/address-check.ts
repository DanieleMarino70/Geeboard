import "server-only";
import { Resolver } from "node:dns/promises";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { judgeAddress, lookupFailure, type AddressVerdict, type Lookup } from "@/domain/dns/address";
import { nodeAddress } from "@/domain/dns/rules";
import { db } from "./db";
import { dnsProviderFacts } from "./dns-ops";

/* What a name resolves to, asked of the DNS itself — not of the hosts file,
   which would answer for `localhost` and for names nobody else can see. A
   name with no address record is `missing`, which is an answer; a name the
   resolver could not be asked about is `failed`, which is not. The wait is
   short because somebody is typing into a form. */
export async function lookupHost(host: string): Promise<Lookup> {
  const resolver = new Resolver({ timeout: 2500, tries: 1 });
  const addresses: string[] = [];
  let failure: string | null = null;
  for (const resolve of [(h: string) => resolver.resolve4(h), (h: string) => resolver.resolve6(h)]) {
    try {
      addresses.push(...(await resolve(host)));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENODATA" && code !== "ENOTFOUND") failure = lookupFailure(code);
    }
  }
  if (addresses.length > 0) return { kind: "found", addresses };
  return failure ? { kind: "failed", reason: failure } : { kind: "missing" };
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/;

export type AddressCheck = { ok: true; verdict: AddressVerdict } | { ok: false };

/* The create wizard's check of the address, after it is typed. For
   whoever may create a server, since it is that form's and asks the DNS on
   their behalf; and for no more than a well-formed name, which is all the
   wizard lets through to it. */
export async function checkAddressOp(actor: User, raw: string, lookup: (host: string) => Promise<Lookup> = lookupHost): Promise<AddressCheck> {
  if (!can(actor, "server.create")) return { ok: false };
  const host = raw.trim().toLowerCase();
  if (host.length > 253 || !HOST.test(host)) return { ok: false };

  const [found, provider, nodes] = await Promise.all([
    lookup(host),
    dnsProviderFacts(),
    db.node.findMany({ select: { name: true, publicAddress: true, observedAddress: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    ok: true,
    verdict: judgeAddress({
      host,
      lookup: found,
      provider,
      nodes: nodes.map((n) => ({ name: n.name, address: nodeAddress(n).address })),
    }),
  };
}
