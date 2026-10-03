import "server-only";
import type { Node, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import {
  coveredBy,
  decide,
  dnsNeedsSync,
  dnsStateOf,
  duckBase,
  isDnsKind,
  markerFor,
  nodeAddresses,
  sameDuckBase,
  srvOf,
  wantedRecords,
  type DnsKind,
  type DnsRow,
  type DnsState,
  type NodeAddressFacts,
  type RecordKind,
  type WantedRecord,
} from "@/domain/dns/rules";
import { asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { db } from "./db";
import { CloudflareClient } from "./dns/cloudflare";
import { DuckDnsClient } from "./dns/duckdns";
import type { DnsClient } from "./dns/provider";
import { logger } from "./log";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OpResult } from "./server-ops";

/* The DNS provider a workspace writes its servers' records with, and
   the records themselves.

   With no provider configured, none of this runs: a server's address is
   a hostname somebody points at the node themselves, as it always was,
   and every hook below returns before it reads anything else. With one,
   a server whose host is under the provider's zone gets a record at
   creation that points at its node, follows the node when the server
   moves or the node's address changes, is rewritten when the host
   changes, and is removed with the server. A record the provider will
   not write is never a reason a server is not created, moved or
   deleted: the failure is kept on the server, shown on its page, and
   retried by the poller.

   Saved like the bucket's secret and the Steam key: encrypted at rest,
   tested before it is kept, and never sent back to a browser. */

const ID = "dns";

interface Provider {
  kind: DnsKind;
  zone: string;
  client: DnsClient;
}

async function provider(): Promise<Provider | null> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID } });
  if (!row || !isDnsKind(row.kind)) return null;
  let token: string;
  try {
    token = decryptSecret(row.token);
  } catch (error) {
    logger.warn("dns token does not decrypt", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  const client: DnsClient =
    row.kind === "cloudflare" ? new CloudflareClient(row.zone, token, row.zoneId) : new DuckDnsClient(token, row.checkHost);
  return { kind: row.kind, zone: row.zone, client };
}

/** The zone records go under, for the wizard's default address. Null with no provider. */
export async function dnsZone(): Promise<string | null> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID }, select: { zone: true, kind: true } });
  return row && isDnsKind(row.kind) ? row.zone : null;
}

/* The domain a new server's address is proposed under. The zone, for a
   provider whose zone is the whole of what the account holds; for DuckDNS
   the subdomain the token was checked with — the account's own, made on
   duckdns.org, and the one every name under it follows — since
   `<name>.duckdns.org` is nobody's until it is made. Null with no provider. */
export async function dnsDefaultDomain(): Promise<string | null> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID }, select: { zone: true, kind: true, checkHost: true } });
  if (!row || !isDnsKind(row.kind)) return null;
  return row.kind === "duckdns" && row.checkHost ? `${row.checkHost}.${row.zone}` : row.zone;
}

/** The provider's facts a page needs to say how a server's record stands. Null with none. */
export async function dnsProviderFacts(): Promise<{ kind: DnsKind; zone: string } | null> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID }, select: { zone: true, kind: true } });
  return row && isDnsKind(row.kind) ? { kind: row.kind, zone: row.zone } : null;
}

export interface DnsStatus {
  kind: DnsKind | null;
  zone: string | null;
  checkHost: string | null;
  /** A provider is saved and its token cannot be decrypted with this panel's SECRETS_KEY. */
  unreadable: boolean;
  configuredBy: string | null;
  configuredAt: Date | null;
  checkedAt: Date | null;
  checkError: string | null;
}

/** What the DNS page shows about the provider — nothing of the token. */
export async function dnsStatus(): Promise<DnsStatus> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID } });
  if (!row) return { kind: null, zone: null, checkHost: null, unreadable: false, configuredBy: null, configuredAt: null, checkedAt: null, checkError: null };
  let unreadable = false;
  try {
    decryptSecret(row.token);
  } catch {
    unreadable = true;
  }
  const by = row.configuredById ? await db.user.findUnique({ where: { id: row.configuredById }, select: { name: true } }) : null;
  return {
    kind: isDnsKind(row.kind) ? row.kind : null,
    zone: row.zone,
    checkHost: row.checkHost,
    unreadable,
    configuredBy: by?.name ?? null,
    configuredAt: row.updatedAt,
    checkedAt: row.checkedAt,
    checkError: row.checkError,
  };
}

function refuse(title: string, body: string): OpResult {
  return { ok: false, title, body };
}

async function record(actor: string, action: string, target: string, tone: "INFO" | "WARNING" | "SUCCESS", userId?: string, serverId?: string, changes?: Record<string, { from: string; to: string }>) {
  await db.activityEvent.create({ data: { actor, action, target, tone, userId, serverId, changes } });
}

export interface DnsProviderInput {
  kind: string;
  token: string;
  /** Cloudflare: the zone's name. Ignored for DuckDNS, whose zone is duckdns.org. */
  zone?: string;
  /** DuckDNS: one of the account's subdomains, to check the token with. */
  checkHost?: string;
}

const ZONE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/;

/* Saving a provider: nothing is kept that did not just work, as with
   the bucket and the Steam key. The probe proves the token can do what
   the panel will ask of it, on the zone it will ask about. */
export async function configureDnsOp(actor: User, input: DnsProviderInput): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can set the DNS provider.");
  if (!isDnsKind(input.kind)) return refuse("Check the form", "Choose Cloudflare or DuckDNS.");
  const token = input.token.trim();
  if (token.length < 8 || /\s/.test(token)) return refuse("Check the form", "That is not a token.");

  const zone = input.kind === "duckdns" ? "duckdns.org" : (input.zone ?? "").trim().toLowerCase();
  if (!ZONE.test(zone)) return refuse("Check the form", "A zone is a domain name, like example.com.");
  const checkHost = input.kind === "duckdns" ? (input.checkHost ?? "").trim().toLowerCase().replace(/\.duckdns\.org$/, "") : null;
  if (input.kind === "duckdns" && !/^[a-z0-9-]+$/.test(checkHost ?? "")) {
    return refuse("Check the form", "Name one of the account's subdomains, like myserver for myserver.duckdns.org, to check the token with.");
  }

  const client: DnsClient = input.kind === "cloudflare" ? new CloudflareClient(zone, token, null) : new DuckDnsClient(token, checkHost);
  let learned: { zoneId?: string };
  try {
    learned = await client.probe();
  } catch (error) {
    const failure = asPlatformError(error);
    return failure.code === "DNS_TOKEN_REFUSED"
      ? refuse(`${label(input.kind)} refused that token`, `${failure.message} Nothing was saved.`)
      : refuse(`Could not ask ${label(input.kind)}`, `${failure.message} Nothing was saved.`);
  }

  const data = {
    kind: input.kind,
    token: encryptSecret(token),
    zone,
    zoneId: learned.zoneId ?? null,
    checkHost,
    checkedAt: new Date(),
    checkError: null,
    configuredById: actor.id,
  };
  await db.dnsProvider.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  await record(actor.name, "dns.configured", `${label(input.kind)} · ${zone}`, "INFO", actor.id);

  return {
    ok: true,
    tone: "success",
    title: `Records under ${zone} are the panel's to keep`,
    body: `${label(input.kind)} accepted the token. It is stored encrypted and will not be shown again. Servers whose address is under ${zone} get their record within a minute; a new server gets it as it is created.`,
  };
}

export async function checkDnsOp(actor: User): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can check the DNS provider.");
  const p = await provider();
  if (!p) return refuse("No provider", "There is no DNS provider to check. Set one first.");
  try {
    const learned = await p.client.probe();
    await db.dnsProvider.update({ where: { id: ID }, data: { checkedAt: new Date(), checkError: null, ...(learned.zoneId ? { zoneId: learned.zoneId } : {}) } });
  } catch (error) {
    const failure = asPlatformError(error);
    await db.dnsProvider.update({ where: { id: ID }, data: { checkedAt: new Date(), checkError: failure.message } });
    return failure.code === "DNS_TOKEN_REFUSED"
      ? refuse(`${label(p.kind)} refused the token`, `${failure.message} Replace it here.`)
      : refuse(`Could not ask ${label(p.kind)}`, failure.message);
  }
  await record(actor.name, "dns.checked", `${label(p.kind)} · ${p.zone}`, "INFO", actor.id);
  return { ok: true, tone: "success", title: `${label(p.kind)} accepts the token`, body: `Records under ${p.zone} can be written.` };
}

/* Forgetting the provider. The records it wrote stay where they are —
   the panel has no token to remove them with any more, and a name that
   resolves is not a fault — and the servers forget them, so a provider
   set later starts from what it finds. */
export async function removeDnsOp(actor: User): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can remove the DNS provider.");
  const row = await db.dnsProvider.findUnique({ where: { id: ID } });
  if (!row) return refuse("No provider", "No DNS provider is saved.");
  const kept = await db.serverDnsRecord.count({ where: { content: { not: null } } });
  await db.$transaction([db.dnsProvider.delete({ where: { id: ID } }), db.serverDnsRecord.deleteMany({})]);
  await record(actor.name, "dns.removed", `${label(row.kind)} · ${row.zone}`, "WARNING", actor.id);
  return {
    ok: true,
    tone: "warning",
    title: "DNS provider removed",
    body:
      kept > 0
        ? `${kept} record${kept === 1 ? "" : "s"} the panel wrote ${kept === 1 ? "stays" : "stay"} at ${label(row.kind)}, and ${kept === 1 ? "is" : "are"} yours to keep or remove there. Addresses are pointed at nodes by hand from now on.`
        : "Addresses are pointed at nodes by hand from now on.",
  };
}

function label(kind: string): string {
  return kind === "cloudflare" ? "Cloudflare" : "DuckDNS";
}

export interface DnsSyncResult {
  state: DnsState;
  /** One sentence for a toast, or null when there is nothing to say (no provider, host outside the zone). */
  message: string | null;
}

const ROW_SELECT = { kind: true, name: true, providerRecordId: true, content: true, checkedAt: true, error: true } as const;
const NODE_SELECT = { name: true, publicAddress: true, publicAddress6: true, observedAddress: true } as const;
const SERVER_SELECT = {
  id: true,
  name: true,
  host: true,
  port: true,
  nodeId: true,
  gameId: true,
  dnsRecords: { select: ROW_SELECT },
  node: { select: NODE_SELECT },
} as const;

type Row = { kind: string; name: string; providerRecordId: string | null; content: string | null; checkedAt: Date | null; error: string | null };
type ServerForDns = { id: string; name: string; host: string; port: number; nodeId: string; gameId: string | null; dnsRecords: Row[] };

const asRows = (rows: Row[]): DnsRow[] => rows.map((r) => ({ kind: r.kind, name: r.name, content: r.content, checkedAt: r.checkedAt, error: r.error }));

/** The SRV record this server's game asks for, with the port of the block the server holds; null when it asks for none. */
function srvFor(server: { gameId: string | null; port: number }) {
  return srvOf(server.gameId ? findGame(server.gameId) : undefined, server.port);
}

const KIND_LABEL: Record<RecordKind, string> = { A: "Address", AAAA: "IPv6 address", SRV: "SRV" };

/* The other servers whose name is under the same DuckDNS subdomain, and so
   share its one address. Empty for any other provider, where every host
   has a record of its own. */
async function sharingBase(p: Provider, server: { id: string; host: string }) {
  const base = p.kind === "duckdns" ? duckBase(server.host) : null;
  if (!base) return [];
  return db.server.findMany({
    where: { id: { not: server.id }, OR: [{ host: `${base}.duckdns.org` }, { host: { endsWith: `.${base}.duckdns.org` } }] },
    select: { id: true, name: true, nodeId: true, dnsRecords: { select: { kind: true, content: true, error: true } }, node: { select: { name: true } } },
  });
}

type Sibling = Awaited<ReturnType<typeof sharingBase>>[number];

/* Making a server's records say what its node and its game say, or learning
   why they cannot. Called from the lifecycle hooks and the poller; never
   throws, since a record is not a reason a server is not created — what went
   wrong is kept on the record and said back. */
export async function syncServerDns(serverId: string, actor = "Panel", userId?: string): Promise<DnsSyncResult> {
  const p = await provider();
  if (!p) return { state: "none", message: null };
  const server = await db.server.findUnique({ where: { id: serverId }, select: SERVER_SELECT });
  if (!server) return { state: "none", message: null };
  return syncLoaded(p, server, server.node, actor, userId);
}

async function syncLoaded(p: Provider, server: ServerForDns, node: NodeAddressFacts & { name: string }, actor: string, userId?: string): Promise<DnsSyncResult> {
  if (!coveredBy(p.kind, p.zone, server.host)) {
    if (server.dnsRecords.length > 0) await db.serverDnsRecord.deleteMany({ where: { serverId: server.id } });
    return { state: "outside", message: null };
  }
  const wanted = wantedRecords({ host: server.host, node, provider: p, srv: srvFor(server) });
  if (wanted.records.length === 0) {
    await db.serverDnsRecord.updateMany({ where: { serverId: server.id }, data: { checkedAt: new Date(), error: null } });
    return {
      state: "no-address",
      message:
        wanted.reason === "private"
          ? `No DNS record: the panel sees ${node.name} from a private address. Set its public address on the node's page.`
          : `No DNS record yet: ${node.name} has no public address. Set one on the node's page.`,
    };
  }

  const siblings = await sharingBase(p, server);
  let force = false;

  /* A record the panel keeps and no longer wants: the node's IPv6 address was taken away, or the
     game stopped asking for an SRV. It goes, and a failure to remove it is kept on its row. DuckDNS
     can only clear a subdomain whole, so removing one family there is removing both, and what is
     still wanted is written again. */
  for (const row of server.dnsRecords.filter((r) => !wanted.records.some((w) => w.kind === r.kind))) {
    const failure = await removeRow(p, server, row, siblings, actor, userId);
    if (failure) return { state: "failed", message: failure };
    if (p.kind === "duckdns" && siblings.length === 0) force = true;
  }

  const results: Array<{ record: WantedRecord; state: "set" | "failed"; message: string; adopted: boolean }> = [];
  for (const record of wanted.records) {
    results.push(await syncOne(p, server, record, node.name, siblings, force, actor, userId));
  }
  const failed = results.find((r) => r.state === "failed");
  if (failed) return { state: "failed", message: failed.message };
  const addresses = results.filter((r) => r.record.kind !== "SRV").map((r) => r.record.content);
  const adopted = results.find((r) => r.adopted);
  const srv = results.find((r) => r.record.kind === "SRV");
  return {
    state: "set",
    message: adopted
      ? `${server.host} already pointed at ${adopted.record.content}; the record is the panel's to keep now.`
      : `${server.host} points at ${addresses.join(" and ")}${srv ? `, and its SRV record carries port ${srv.record.content.split(" ")[2]}: players need only the name` : ""}.`,
  };
}

/* One record: read what is at its name, decide, write, keep the row. */
async function syncOne(
  p: Provider,
  server: ServerForDns,
  w: WantedRecord,
  nodeName: string,
  siblings: Sibling[],
  force: boolean,
  actor: string,
  userId?: string,
): Promise<{ record: WantedRecord; state: "set" | "failed"; message: string; adopted: boolean }> {
  const marker = markerFor(server.id);
  const row = server.dnsRecords.find((r) => r.kind === w.kind) ?? null;
  const target = `${w.name} → ${w.content}`;
  const keep = (data: { providerRecordId?: string | null; content?: string | null; error: string | null }) =>
    db.serverDnsRecord.upsert({
      where: { serverId_kind: { serverId: server.id, kind: w.kind } },
      create: { serverId: server.id, kind: w.kind, name: w.name, providerRecordId: data.providerRecordId ?? null, content: data.content ?? null, checkedAt: new Date(), error: data.error },
      update: { name: w.name, checkedAt: new Date(), error: data.error, ...(data.providerRecordId !== undefined ? { providerRecordId: data.providerRecordId } : {}), ...(data.content !== undefined ? { content: data.content } : {}) },
    });
  const fail = async (action: string, reason: string, message: string) => {
    await keep({ error: reason });
    await record(actor, action, target, "WARNING", userId, server.id, { Reason: { from: "—", to: reason } });
    return { record: w, state: "failed" as const, message, adopted: false };
  };

  try {
    /* The host changed under a record that is still at the old name: take it away from there first. */
    if (row && row.name !== w.name && !(p.kind === "duckdns" && sameDuckBase(row.name, w.name))) {
      await p.client.remove({ kind: w.kind, name: row.name }, row.providerRecordId);
    }
    const was = row?.content ?? null;

    /* Under DuckDNS a name's address is its subdomain's, and a subdomain has one of each family.
       Servers on the same node agree, and only the first has to write it; a server on another node
       would move it out from under them, so the one already holding it keeps it and the other is
       told. Holding is a written record and nothing else: a server that was refused, or whose write
       failed, holds nothing however long it has been there, or it would keep the whole subdomain from
       the servers that can use it. */
    if (p.kind === "duckdns" && siblings.length > 0 && w.kind !== "SRV") {
      const others = siblings.filter((s) => s.nodeId !== server.nodeId);
      const holder = others.find((s) => s.dnsRecords.some((r) => r.kind === w.kind && r.content && !r.error));
      if (holder) {
        const base = duckBase(server.host);
        const reason = `${base}.duckdns.org already points at ${holder.node.name}, for ${holder.name}. A DuckDNS name has one address, so servers on ${nodeName} need a subdomain of their own, made on duckdns.org`;
        return fail("server.dns.refused", reason, `The DNS record was not written: ${reason}.`);
      }
      if (siblings.some((s) => s.nodeId === server.nodeId && s.dnsRecords.some((r) => r.kind === w.kind && r.content === w.content && !r.error))) {
        // A server on this node already wrote it, and DuckDNS asks not to be updated for nothing.
        await keep({ providerRecordId: null, content: w.content, error: null });
        if (was !== w.content) {
          await record(actor, was ? "server.dns.updated" : "server.dns.set", target, "INFO", userId, server.id, {
            [KIND_LABEL[w.kind]]: { from: was ?? "—", to: w.content },
            "Shared with": { from: "—", to: `${siblings.length} other server${siblings.length === 1 ? "" : "s"} under ${duckBase(server.host)}.duckdns.org` },
          });
        }
        return { record: w, state: "set", message: `${server.host} points at ${w.content}.`, adopted: false };
      }
    }

    const existing = await p.client.read(w.name);
    const decision = decide(existing, w, marker);
    if (decision.action === "refuse") return fail("server.dns.refused", decision.reason, `The DNS record was not written: ${decision.reason}.`);
    let id = "id" in decision ? decision.id : null;
    /* An adopted record is written once too, unchanged but for the marker: from then on it is the
       panel's, and follows the node. A record that says the right thing is not written again, except
       where the provider lost the other family with a clear (force). */
    if (decision.action === "create" || decision.action === "update" || decision.action === "adopt" || force) {
      id = await p.client.write(w, marker, decision.action === "create" ? null : id);
    }
    await keep({ providerRecordId: id, content: w.content, error: null });
    const action = decision.action === "adopt" ? "server.dns.adopted" : decision.action === "update" || (was && was !== w.content) ? "server.dns.updated" : decision.action === "nothing" ? null : "server.dns.set";
    if (action) await record(actor, action, target, "INFO", userId, server.id, { [KIND_LABEL[w.kind]]: { from: was ?? "—", to: w.content } });
    return { record: w, state: "set", message: `${w.name} says ${w.content}.`, adopted: decision.action === "adopt" };
  } catch (error) {
    const failure = asPlatformError(error);
    return fail("server.dns.failed", failure.message, `The DNS record was not written: ${failure.message} The panel will try again.`);
  }
}

/* Taking one record the panel kept away from where it is, and forgetting it. Null when it went; the sentence
   to say when it did not. Under DuckDNS, with another server on the subdomain, the address is left where it is. */
async function removeRow(p: Provider, server: ServerForDns, row: Row, siblings: Sibling[], actor: string, userId?: string): Promise<string | null> {
  const forget = () => db.serverDnsRecord.deleteMany({ where: { serverId: server.id, kind: row.kind } });
  const changes = { [KIND_LABEL[row.kind as RecordKind]]: { from: row.content ?? "—", to: "—" } };
  if (p.kind === "duckdns" && siblings.length > 0) {
    await forget();
    await record(actor, "server.dns.removed", row.name, "INFO", userId, server.id, {
      ...changes,
      "Still used by": { from: "—", to: `${siblings.length} other server${siblings.length === 1 ? "" : "s"} under ${duckBase(server.host)}.duckdns.org` },
    });
    return null;
  }
  try {
    await p.client.remove({ kind: row.kind as RecordKind, name: row.name }, row.providerRecordId);
    await forget();
    await record(actor, "server.dns.removed", row.name, "INFO", userId, server.id, changes);
    return null;
  } catch (error) {
    const failure = asPlatformError(error);
    await db.serverDnsRecord.updateMany({ where: { serverId: server.id, kind: row.kind }, data: { checkedAt: new Date(), error: failure.message } });
    await record(actor, "server.dns.orphaned", row.name, "WARNING", userId, server.id, { Reason: { from: "—", to: failure.message } });
    return `The DNS record for ${row.name} was not removed: ${failure.message} It is still at ${label(p.kind)}.`;
  }
}

/* Removing a server's records, before the server goes or after its host
   changed. A record that will not go is not a reason the server stays: the
   audit log names what was left at the provider. */
export async function forgetServerDns(server: { id: string; name: string; host: string }, actor = "Panel", userId?: string): Promise<string | null> {
  const rows = await db.serverDnsRecord.findMany({ where: { serverId: server.id }, select: ROW_SELECT });
  if (rows.length === 0) return null;
  const p = await provider();
  if (!p || !coveredBy(p.kind, p.zone, server.host)) return null;
  /* A DuckDNS subdomain is shared by every name under it, so it goes only with the last of them: while
     another server still uses it, this one lets go of it and leaves the address where it is. And one
     clear takes both families, so it is asked once. */
  const siblings = await sharingBase(p, server);
  const messages: string[] = [];
  let cleared = false;
  for (const row of rows) {
    if (cleared) {
      await db.serverDnsRecord.deleteMany({ where: { serverId: server.id, kind: row.kind } });
      continue;
    }
    const failure = await removeRow(p, { ...server, port: 0, nodeId: "", gameId: null, dnsRecords: rows }, row, siblings, actor, userId);
    if (failure) messages.push(failure);
    else if (p.kind === "duckdns") cleared = true;
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

/* One pass over every server whose records are the panel's to keep, for
   the poller: a node whose address moved, a record that failed five minutes
   ago or more, a server created before the provider was, a record no longer
   wanted. Cheap when there is nothing to do — one query and no call. */
export async function reconcileDns(): Promise<{ synced: number; failed: number }> {
  const p = await provider();
  const out = { synced: 0, failed: 0 };
  if (!p) return out;
  const servers = await db.server.findMany({
    where: { state: { notIn: ["CREATING", "DELETING", "MIGRATING"] } },
    select: SERVER_SELECT,
  });
  const now = Date.now();
  for (const server of servers) {
    if (!dnsNeedsSync({ host: server.host, rows: asRows(server.dnsRecords) }, p, server.node, srvFor(server), now)) continue;
    const result = await syncLoaded(p, server, server.node, "Panel");
    if (result.state === "set") out.synced++;
    else if (result.state === "failed") out.failed++;
  }
  return out;
}

/** The Retry button: try a server's records now rather than on the poller's clock. */
export async function retryServerDnsOp(actor: User, slug: string): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can retry a DNS record.");
  const server = await db.server.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!server) return refuse("Cannot retry", "That server no longer exists.");
  const result = await syncServerDns(server.id, actor.name, actor.id);
  if (result.state === "none") return refuse("No provider", "No DNS provider is configured.");
  if (result.state === "outside") return refuse("Outside the zone", `${server.name}'s address is not under the provider's zone, so its record is yours to keep.`);
  return result.state === "set"
    ? { ok: true, tone: "success", title: "Record written", body: result.message ?? "" }
    : { ok: false, title: result.state === "no-address" ? "No address to point at" : "Record not written", body: result.message ?? "" };
}

/** How a server's records stand, for its page and the API. */
export function serverDnsView(server: { host: string; dnsRecords: DnsRow[] }, node: NodeAddressFacts | null, facts: { kind: DnsKind; zone: string } | null) {
  return dnsStateOf(server, facts, node, server.dnsRecords);
}

/** The node's addresses for records, with where they came from, for the node's page. */
export function nodeAddressView(node: Pick<Node, "publicAddress" | "publicAddress6" | "observedAddress">) {
  return nodeAddresses(node);
}
