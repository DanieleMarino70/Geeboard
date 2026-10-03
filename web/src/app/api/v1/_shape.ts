import "server-only";
import type { ActivityEvent, Backup, Node, ScheduledTask, Server } from "@prisma/client";
import { dnsStateOf, type DnsKind, type DnsRow } from "@/domain/dns/rules";
import { findGame, isCommunityId, isOffered } from "@/domain/games/registry";
import { serverOfEvent } from "@/lib/audit";
import { portsFor, primaryPort } from "@/domain/games/types";
import type { GameDefinition } from "@/domain/games/types";

/* What the API says a thing is.

   These shapes are the API's contract, and they are deliberately not the
   database rows. Two reasons. The obvious one: a row carries an
   encrypted node token and a bcrypt hash, and neither of those is ever
   leaving this process. The one that matters more: the API speaks in
   games, versions, nodes and servers, so nothing here says "container"
   or "image" — a client that learned to depend on those would break the
   day a node ran something else, which is exactly what the runtime
   abstraction exists to prevent. */

/** The revision of a community game that an owner approved: what the API says it is running on. */
export interface ApprovedRevision {
  number: number;
  hash: string;
}

export function gameShape(game: GameDefinition, approved?: ApprovedRevision) {
  const community = isCommunityId(game.id);
  return {
    id: game.id,
    name: game.name,
    family: game.family,
    blurb: game.blurb,
    official: game.official,
    // A game somebody wrote and an owner approved; `revision` is the one approved, and null once it is retired.
    community,
    retired: community && !isOffered(game.id),
    revision: community && approved ? { number: approved.number, hash: approved.hash } : null,
    art: game.art,
    install: game.install.kind,
    requirements: {
      memoryGbMin: game.requirements.memoryGbMin,
      cpuPctMin: game.requirements.cpuPctMin,
      diskGbMin: game.requirements.diskGbMin,
      os: game.requirements.os,
      arch: game.requirements.arch,
      capabilities: game.requirements.capabilities,
    },
    defaults: game.defaults,
    limits: game.limits,
    ports: game.ports.map((p) => ({
      id: p.id,
      label: p.label,
      protocol: p.protocol,
      primary: p.primary === true,
      public: p.public !== false,
    })),
    settings: game.config.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      default: f.default,
      group: f.group ?? null,
      advanced: f.advanced === true,
      restartRequired: f.restartRequired === true,
      options: f.options ?? null,
      min: f.min ?? null,
      max: f.max ?? null,
    })),
    templates: game.templates.map((t) => ({
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      summary: t.summary,
    })),
    versionCount: game.versions.length,
  };
}

export function nodeShape(node: Node, extra: { servers: number }) {
  return {
    name: node.name,
    region: node.region,
    city: node.city,
    state: node.state,
    runtime: node.runtime,
    os: node.os,
    arch: node.arch,
    capabilities: node.capabilities,
    agentVersion: node.daemon,
    /* What the agent speaks to the panel, apart from which release it is;
       null for an agent that sends none, which is judged by its release. */
    agentContract: node.contract,
    /* Whether an agent is attached, never where it is or what it is
       reached with. The URL and the token stay on this side. */
    attached: Boolean(node.daemonUrl && node.daemonToken),
    lastSeenAt: node.lastSeenAt,
    /* Heard from, and reached: an agent can call the panel from behind a
       port nothing can call back through, and health follows the second. */
    lastReachedAt: node.lastReachedAt,
    pingMs: node.pingMs,
    resources: {
      cpuCores: node.cpuCores,
      ramTotalGb: node.ramTotal,
      diskTotalGb: node.diskTotal,
      cpuPct: node.cpuPct,
      ramPct: node.ramPct,
      diskPct: node.diskPct,
    },
    servers: extra.servers,
  };
}

export function backupShape(backup: Backup & { server?: { slug: string } | null }) {
  return {
    id: backup.id,
    /* Null once the server has been deleted: an off-site backup outlives
       it, and `deletedServer` then says what it was a backup of and which
       game a server has to run to take it. */
    server: backup.server?.slug ?? backup.serverId,
    deletedServer: backup.serverId ? null : { name: backup.originServerName, gameId: backup.originGameId },
    name: backup.name,
    state: backup.state,
    trigger: backup.trigger,
    /* LOCAL is the node's own disk; S3 is the workspace's bucket. What
       the node calls the archive is its business, and off-site keys are
       derived from the server and the name — neither is an address a
       client should hold. */
    store: backup.store,
    sizeBytes: Number(backup.sizeBytes),
    checksum: backup.checksum,
    durationMs: backup.durationMs,
    error: backup.error,
    /* When the archive was last read back and compared with `checksum`,
       and what that found wrong. Both null means nobody has looked since
       it was written — not that it is sound. */
    verifiedAt: backup.verifiedAt,
    verifyError: backup.verifyError,
    createdAt: backup.createdAt,
  };
}

export function taskShape(task: ScheduledTask & { server?: { slug: string } }) {
  return {
    id: task.id,
    server: task.server?.slug ?? task.serverId,
    name: task.name,
    kind: task.kind,
    cron: task.cron,
    payload: task.payload,
    enabled: task.enabled,
    lastRunAt: task.lastRunAt,
    lastResult: task.lastResult,
    nextRunAt: task.nextRunAt,
  };
}

export function eventShape(
  event: ActivityEvent & { server?: { slug: string; name: string } | null; targetHidden?: boolean },
) {
  return {
    id: event.id,
    at: event.createdAt,
    actor: event.actor,
    action: event.action,
    target: event.target,
    // Null above because the caller may not read this console's commands, not because there was none.
    targetHidden: event.targetHidden === true,
    tone: event.tone,
    // A deleted server is still named, and says it is deleted.
    server: serverOfEvent(event),
    changes: event.changes,
  };
}

/* How a server's DNS record stands, for the shape: `none` with no
   provider, `outside` for a host the provider's zone does not cover,
   `no-address` while its node has no public address, `set` with the
   address written, `failed` with why. The provider's facts and the
   node's addresses are the caller's to pass — a list looks them up once. */
export type ServerDnsShape = ReturnType<typeof dnsStateOf>;

export function serverShape(
  server: Server & { node: { name: string; region: string }; dnsRecords?: DnsRow[] },
  dns?: { provider: { kind: DnsKind; zone: string } | null; node: { publicAddress: string | null; publicAddress6?: string | null; observedAddress: string | null } | null },
) {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const ports = game ? portsFor(game, server.port) : [];
  const records = dns ? dnsStateOf(server, dns.provider, dns.node, server.dnsRecords ?? []) : null;

  return {
    ...(records ? { dns: records } : {}),
    id: server.id,
    slug: server.slug,
    name: server.name,
    state: server.state,
    game: { id: server.gameId, family: server.game },
    version: { id: server.gameVersionId, label: server.version },
    node: { name: server.node.name, region: server.node.region },
    runtime: server.runtime,
    address: {
      host: server.host,
      port: game ? primaryPort(game, server.port) : server.port,
      // True when an SRV record is written: players type the host alone and the port is found for them.
      ...(records ? { srv: records.byName } : {}),
    },
    ports: ports
      // An administrative port is not an address to hand out.
      .filter((p) => p.public)
      .map((p) => ({ id: p.id, label: p.label, port: p.host, protocol: p.protocol })),
    players: { online: server.playersOn, max: server.playersMax },
    resources: {
      memoryGb: server.memoryLimit,
      cpuLimit: server.cpuLimit,
      diskGb: server.diskQuota,
      cpuPct: server.cpuPct,
      ramPct: server.ramPct,
    },
    startedAt: server.startedAt,
    createdAt: server.createdAt,
    lastError: server.lastError,
    owner: server.ownerId,
  };
}
