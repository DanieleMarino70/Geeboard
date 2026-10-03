import "server-only";
import type { Node, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import {
  DNS_KINDS,
  DNS_PROVIDERS,
  DNS_RETRY_MS,
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
  type DnsDecision,
  type DnsKind,
  type DnsProviderFacts,
  type DnsRow,
  type DnsState,
  type NodeAddressFacts,
  type RecordKind,
  type WantedRecord,
} from "@/domain/dns/rules";
import { judgeSigningSecret } from "@/domain/dns/webhook";
import { asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { describeDestination, judgeUrl, policyFromEnvironment } from "@/domain/notify/destination";
import { newSigningSecret } from "@/domain/notify/format";
import { db } from "./db";
import { CloudflareClient } from "./dns/cloudflare";
import { DuckDnsClient } from "./dns/duckdns";
import { ProviderUnreachable, type DnsClient } from "./dns/provider";
import { WebhookClient } from "./dns/webhook";
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
  /** What this kind can do: whether it can be asked what is at a name, whether it holds an SRV. */
  facts: DnsProviderFacts;
  zone: string;
  client: DnsClient;
}

function never(kind: never): never {
  throw new Error(`no client for DNS provider kind ${String(kind)}`);
}

/* The client for a stored provider: one case for each kind, and no default, so that a kind added to the
   table and not here does not compile, and one stored by a newer panel is not taken for DuckDNS. */
function clientFor(
  kind: DnsKind,
  row: { zone: string; zoneId: string | null; checkHost: string | null },
  token: string,
  endpoint: string | null,
): DnsClient | null {
  switch (kind) {
    case "cloudflare":
      return new CloudflareClient(row.zone, token, row.zoneId);
    case "duckdns":
      return new DuckDnsClient(token, row.checkHost);
    case "webhook":
      return endpoint ? new WebhookClient(row.zone, endpoint, token) : null;
    default:
      return never(kind);
  }
}

async function provider(): Promise<Provider | null> {
  const row = await db.dnsProvider.findUnique({ where: { id: ID } });
  if (!row) return null;
  if (!isDnsKind(row.kind)) {
    logger.warn("dns provider of a kind this panel does not know", { kind: row.kind });
    return null;
  }
  let token: string;
  let endpoint: string | null = null;
  try {
    token = decryptSecret(row.token);
    endpoint = row.endpoint ? decryptSecret(row.endpoint) : null;
  } catch (error) {
    logger.warn("dns token does not decrypt", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  const client = clientFor(row.kind, row, token, endpoint);
  if (!client) {
    logger.warn("dns provider has no address", { kind: row.kind });
    return null;
  }
  return { kind: row.kind, facts: DNS_PROVIDERS[row.kind], zone: row.zone, client };
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
  /** A webhook's host, never its path: the address can hold a secret. Null for any other kind. */
  receiver: string | null;
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
  if (!row) return { kind: null, zone: null, checkHost: null, receiver: null, unreadable: false, configuredBy: null, configuredAt: null, checkedAt: null, checkError: null };
  let unreadable = false;
  let receiver: string | null = null;
  try {
    decryptSecret(row.token);
    if (row.endpoint) receiver = describeDestination("WEBHOOK", decryptSecret(row.endpoint));
  } catch {
    unreadable = true;
  }
  const by = row.configuredById ? await db.user.findUnique({ where: { id: row.configuredById }, select: { name: true } }) : null;
  return {
    kind: isDnsKind(row.kind) ? row.kind : null,
    zone: row.zone,
    checkHost: row.checkHost,
    receiver,
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
  /** The provider's token; for a webhook, the secret its requests are signed with. */
  token: string;
  /** Cloudflare: the zone's name. A webhook: the domain its receiver writes in. Ignored for DuckDNS, whose zone is duckdns.org. */
  zone?: string;
  /** DuckDNS: one of the account's subdomains, to check the token with. */
  checkHost?: string;
  /** A webhook: the receiver's address. */
  endpoint?: string;
}

const ZONE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/;

/* A signing secret for a webhook, made and handed back and kept nowhere: it is shown in the form so that it can be put
   in the receiver, which has to hold it before it can answer the test that saves it — a receiver that checks signatures
   and does not know the secret yet refuses the first call. Saving it is configureDnsOp's, after the test. */
export function newWebhookSecretOp(actor: User): { ok: true; secret: string } | { ok: false; title: string; body: string } {
  if (!can(actor, "dns.manage")) return { ok: false, title: "Not permitted", body: "Only owners and admins can set the DNS provider." };
  return { ok: true, secret: newSigningSecret() };
}

/* Saving a provider: nothing is kept that did not just work, as with
   the bucket and the Steam key. The probe proves the token can do what
   the panel will ask of it, on the zone it will ask about — for a webhook,
   that the receiver is there and holds the same secret. */
export async function configureDnsOp(actor: User, input: DnsProviderInput): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can set the DNS provider.");
  if (!isDnsKind(input.kind)) return refuse("Check the form", `Choose ${DNS_KINDS.map((k) => k.label).join(", ")}.`);
  const kind = input.kind;
  const facts = DNS_PROVIDERS[kind];
  const token = input.token.trim();
  if (kind === "webhook") {
    const problem = judgeSigningSecret(token);
    if (problem) return refuse("Check the form", problem);
  } else if (token.length < 8 || /\s/.test(token)) {
    return refuse("Check the form", "That is not a token.");
  }

  const zone = facts.zoneFixed ?? (input.zone ?? "").trim().toLowerCase();
  if (!ZONE.test(zone)) return refuse("Check the form", "A zone is a domain name, like example.com.");
  const checkHost = kind === "duckdns" ? (input.checkHost ?? "").trim().toLowerCase().replace(/\.duckdns\.org$/, "") : null;
  if (kind === "duckdns" && !/^[a-z0-9-]+$/.test(checkHost ?? "")) {
    return refuse("Check the form", "Name one of the account's subdomains, like myserver for myserver.duckdns.org, to check the token with.");
  }
  const endpoint = kind === "webhook" ? (input.endpoint ?? "").trim() : null;
  if (kind === "webhook") {
    const verdict = judgeUrl("WEBHOOK", endpoint ?? "", policyFromEnvironment());
    if (!verdict.ok) return refuse("Check the form", verdict.reason);
  }

  const client = clientFor(kind, { zone, zoneId: null, checkHost }, token, endpoint);
  if (!client) return refuse("Check the form", "Paste the receiver's address.");
  let learned: { zoneId?: string };
  try {
    learned = await client.probe();
  } catch (error) {
    const failure = asPlatformError(error);
    return failure.code === "DNS_TOKEN_REFUSED"
      ? refuse(`${facts.label} refused that ${kind === "webhook" ? "signature" : "token"}`, `${failure.message} Nothing was saved.`)
      : refuse(`Could not ask ${facts.label}`, `${failure.message} Nothing was saved.`);
  }

  const data = {
    kind,
    token: encryptSecret(token),
    endpoint: endpoint ? encryptSecret(endpoint) : null,
    zone,
    zoneId: learned.zoneId ?? null,
    checkHost,
    checkedAt: new Date(),
    checkError: null,
    configuredById: actor.id,
  };
  await db.dnsProvider.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  backoffUntil = 0;
  await record(actor.name, "dns.configured", `${facts.label} · ${zone}${endpoint ? ` · ${describeDestination("WEBHOOK", endpoint)}` : ""}`, "INFO", actor.id);

  return {
    ok: true,
    tone: "success",
    title: kind === "webhook" ? `Records under ${zone} go to the receiver` : `Records under ${zone} are the panel's to keep`,
    body:
      kind === "webhook"
        ? `The receiver answered a signed test. Its address and the secret are stored encrypted and will not be shown again. Servers whose address is under ${zone} are sent to it within a minute; a new server is sent as it is created. The panel cannot see your DNS, so a record is accepted by the receiver and not written by the panel.`
        : `${facts.label} accepted the token. It is stored encrypted and will not be shown again. Servers whose address is under ${zone} get their record within a minute; a new server gets it as it is created.`,
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
      ? refuse(`${label(p.kind)} refused the ${p.kind === "webhook" ? "signature" : "token"}`, `${failure.message} Replace it here.`)
      : refuse(`Could not ask ${label(p.kind)}`, failure.message);
  }
  await record(actor.name, "dns.checked", `${label(p.kind)} · ${p.zone}`, "INFO", actor.id);
  return p.kind === "webhook"
    ? { ok: true, tone: "success", title: "The receiver answered the test", body: `Records under ${p.zone} are sent to it.` }
    : { ok: true, tone: "success", title: `${label(p.kind)} accepts the token`, body: `Records under ${p.zone} can be written.` };
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

/* A stored kind's name for a toast or an audit line. A kind this panel does not know is named as it is stored
   and not as another one: removing a provider written by a newer panel has to say what it removed. */
function label(kind: string): string {
  return isDnsKind(kind) ? DNS_PROVIDERS[kind].label : kind;
}

export interface DnsSyncResult {
  state: DnsState;
  /** One sentence for a toast, or null when there is nothing to say (no provider, host outside the zone). */
  message: string | null;
  /** The provider could not be asked at all, which says something about the next server's call as well as this one's. */
  unreachable?: boolean;
}

/** A record that could not be written or removed: the sentence, and whether the provider could not be reached. */
interface Failure {
  message: string;
  unreachable: boolean;
}

type Written = { record: WantedRecord; state: "set" | "failed"; message: string; adopted: boolean; unreachable?: boolean; reason?: string };

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
export async function syncServerDns(serverId: string, actor = "Panel", userId?: string, resend = false): Promise<DnsSyncResult> {
  const p = await provider();
  if (!p) return { state: "none", message: null };
  const server = await db.server.findUnique({ where: { id: serverId }, select: SERVER_SELECT });
  if (!server) return { state: "none", message: null };
  return syncLoaded(p, server, server.node, actor, userId, resend);
}

/* `resend` is somebody asking for it again: a provider that can be read is read, and what it already says is left; one
   that cannot be read has no way to say, so every record is sent once more. Without it, a provider that cannot be read is
   sent what changed and not what the panel already knows it sent. */
async function syncLoaded(p: Provider, server: ServerForDns, node: NodeAddressFacts & { name: string }, actor: string, userId?: string, resend = false): Promise<DnsSyncResult> {
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
  let force = resend && !p.facts.read;

  /* A record the panel keeps and no longer wants: the node's IPv6 address was taken away, or the
     game stopped asking for an SRV. It goes, and a failure to remove it is kept on its row. DuckDNS
     can only clear a subdomain whole, so removing one family there is removing both, and what is
     still wanted is written again. */
  for (const row of server.dnsRecords.filter((r) => !wanted.records.some((w) => w.kind === r.kind))) {
    const failure = await removeRow(p, server, row, siblings, actor, userId);
    if (failure) return { state: "failed", message: failure.message, unreachable: failure.unreachable };
    if (p.kind === "duckdns" && siblings.length === 0) force = true;
  }

  const results: Written[] = [];
  let down: string | null = null;
  for (const record of wanted.records) {
    /* A provider that could not be asked is not asked for the server's other records either, since each would wait
       its whole timeout for the same silence. They are marked as failed all the same, so that the poller waits the
       retry interval for them and does not take a record with no row for one it has not tried yet. */
    const result = await syncOne(p, server, record, node.name, siblings, force, actor, userId, down);
    results.push(result);
    if (result.unreachable && !down) down = result.reason ?? result.message;
  }
  const failed = results.find((r) => r.state === "failed");
  if (failed) return { state: "failed", message: failed.message, unreachable: failed.unreachable ?? false };
  const addresses = results.filter((r) => r.record.kind !== "SRV").map((r) => r.record.content);
  const adopted = results.find((r) => r.adopted);
  const srv = results.find((r) => r.record.kind === "SRV");
  const subject = p.facts.took === "accepted" ? `The receiver accepted ${server.host} → ` : `${server.host} points at `;
  return {
    state: "set",
    message: adopted
      ? `${server.host} already pointed at ${adopted.record.content}; the record is the panel's to keep now.`
      : `${subject}${addresses.join(" and ")}${srv ? `, and its SRV record carries port ${srv.record.content.split(" ")[2]}: players need only the name` : ""}.`,
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
  /** Set when the provider has just failed to answer for this server: no call is made, and the record fails the same way. */
  down: string | null = null,
): Promise<Written> {
  const marker = markerFor(server.id);
  const row = server.dnsRecords.find((r) => r.kind === w.kind) ?? null;
  const target = `${w.name} → ${w.content}`;
  const keep = (data: { providerRecordId?: string | null; content?: string | null; error: string | null }) =>
    db.serverDnsRecord.upsert({
      where: { serverId_kind: { serverId: server.id, kind: w.kind } },
      create: { serverId: server.id, kind: w.kind, name: w.name, providerRecordId: data.providerRecordId ?? null, content: data.content ?? null, checkedAt: new Date(), error: data.error },
      update: { name: w.name, checkedAt: new Date(), error: data.error, ...(data.providerRecordId !== undefined ? { providerRecordId: data.providerRecordId } : {}), ...(data.content !== undefined ? { content: data.content } : {}) },
    });
  const fail = async (action: string, reason: string, message: string, unreachable = false) => {
    await keep({ error: reason });
    await record(actor, action, target, "WARNING", userId, server.id, { Reason: { from: "—", to: reason } });
    return { record: w, state: "failed" as const, message, adopted: false, unreachable, reason };
  };

  try {
    if (down) throw new ProviderUnreachable(down);
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

    /* A provider that can say what is at a name is asked, and a record that is not the panel's is not overwritten.
       One that cannot is written to blind: the same record said again, which it takes as it took it the first time,
       and a record of somebody else's at the name is the receiver's to notice, which is why it is sent the marker. */
    const existing = p.facts.read ? await p.client.read(w.name) : [];
    /* With nothing to read, what the panel kept of the last send is all it knows: a record that said this, without an
       error, is already there, and is not sent again unless it is asked for (force). */
    const known = !p.facts.read && !force && row !== null && row.name === w.name && row.content === w.content && row.error === null;
    const decision: DnsDecision = known ? { action: "nothing", id: row.providerRecordId } : decide(existing, w, marker);
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
    return {
      record: w,
      state: "set",
      message: p.facts.took === "accepted" ? `The receiver accepted ${w.name} → ${w.content}.` : `${w.name} says ${w.content}.`,
      adopted: decision.action === "adopt",
    };
  } catch (error) {
    const failure = asPlatformError(error);
    return fail(
      "server.dns.failed",
      failure.message,
      `The DNS record was not ${p.facts.took === "accepted" ? "taken by the receiver" : "written"}: ${failure.message} The panel will try again.`,
      error instanceof ProviderUnreachable,
    );
  }
}

/* Taking one record the panel kept away from where it is, and forgetting it. Null when it went; what to say
   when it did not. Under DuckDNS, with another server on the subdomain, the address is left where it is. */
async function removeRow(p: Provider, server: ServerForDns, row: Row, siblings: Sibling[], actor: string, userId?: string): Promise<Failure | null> {
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
    return {
      message: `The DNS record for ${row.name} was not removed: ${failure.message} It is still at ${p.facts.took === "accepted" ? "the receiver" : label(p.kind)}.`,
      unreachable: error instanceof ProviderUnreachable,
    };
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
    if (failure) messages.push(failure.message);
    else if (p.kind === "duckdns") cleared = true;
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

/* One pass over every server whose records are the panel's to keep, for
   the poller: a node whose address moved, a record that failed five minutes
   ago or more, a server created before the provider was, a record no longer
   wanted. Cheap when there is nothing to do — one query and no call. */
export async function reconcileDns(): Promise<{ synced: number; failed: number; deferred: number }> {
  const out = { synced: 0, failed: 0, deferred: 0 };
  /* A provider that could not be asked is not asked again for the retry interval. Every call below waits the
     provider's whole timeout when it is down, and a pass that waited it once for each of twenty servers would hold
     the poller's watch on the nodes for minutes. This is the poller's own process; the hooks that create and delete a
     server wait once and say so, and are not held back by it. */
  if (Date.now() < backoffUntil) return out;
  const p = await provider();
  if (!p) return out;
  const servers = await db.server.findMany({
    where: { state: { notIn: ["CREATING", "DELETING", "MIGRATING"] } },
    select: SERVER_SELECT,
  });
  const now = Date.now();
  for (const [i, server] of servers.entries()) {
    if (!dnsNeedsSync({ host: server.host, rows: asRows(server.dnsRecords) }, p, server.node, srvFor(server), now)) continue;
    const result = await syncLoaded(p, server, server.node, "Panel");
    if (result.state === "set") out.synced++;
    else if (result.state === "failed") out.failed++;
    if (result.unreachable) {
      backoffUntil = Date.now() + DNS_RETRY_MS;
      out.deferred = servers.slice(i + 1).filter((s) => dnsNeedsSync({ host: s.host, rows: asRows(s.dnsRecords) }, p, s.node, srvFor(s), now)).length;
      logger.warn("dns provider could not be asked; the rest of the pass is left for later", { provider: p.kind, deferred: out.deferred });
      break;
    }
  }
  return out;
}

/** When the poller may ask the provider again after it could not be asked. Per process; the poller is a process of its own. */
let backoffUntil = 0;

/** The Retry button: try a server's records now rather than on the poller's clock. */
export async function retryServerDnsOp(actor: User, slug: string): Promise<OpResult> {
  if (!can(actor, "dns.manage")) return refuse("Not permitted", "Only owners and admins can retry a DNS record.");
  const server = await db.server.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!server) return refuse("Cannot retry", "That server no longer exists.");
  const result = await syncServerDns(server.id, actor.name, actor.id, true);
  if (result.state === "none") return refuse("No provider", "No DNS provider is configured.");
  if (result.state === "outside") return refuse("Outside the zone", `${server.name}'s address is not under the provider's zone, so its record is yours to keep.`);
  const took = (await provider())?.facts.took ?? "written";
  return result.state === "set"
    ? { ok: true, tone: "success", title: took === "accepted" ? "Record accepted" : "Record written", body: result.message ?? "" }
    : { ok: false, title: result.state === "no-address" ? "No address to point at" : took === "accepted" ? "Record not taken" : "Record not written", body: result.message ?? "" };
}

/** How a server's records stand, for its page and the API. */
export function serverDnsView(server: { host: string; dnsRecords: DnsRow[] }, node: NodeAddressFacts | null, facts: { kind: DnsKind; zone: string } | null) {
  return dnsStateOf(server, facts, node, server.dnsRecords);
}

/** The node's addresses for records, with where they came from, for the node's page. */
export function nodeAddressView(node: Pick<Node, "publicAddress" | "publicAddress6" | "observedAddress">) {
  return nodeAddresses(node);
}
