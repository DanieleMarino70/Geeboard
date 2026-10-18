/* No "server-only" here, and nothing that reads a database: test/api-frozen.test.ts builds every shape below from rows it makes up and
   compares the names with docs/api-frozen.md. Only route handlers import this file. */
import type { ActivityEvent, Backup, Node, ScheduledTask, Server } from "@prisma/client";
import { dnsStateOf, type DnsKind, type DnsRow } from "@/domain/dns/rules";
import { findGame, isCommunityId, isOffered } from "@/domain/games/registry";
import { serverOfEvent } from "@/domain/event-server";
import { portsFor, primaryPort } from "@/domain/games/types";
import type { GameDefinition } from "@/domain/games/types";

/* What the API says a thing is.

   These shapes are the API's contract, and they are deliberately not the
   database rows. Two reasons. The obvious one: a row carries an
   encrypted node token and a bcrypt hash, and neither of those is ever
   leaving this process. The one that matters more: the API speaks in
   games, versions, nodes and servers, so nothing here says "container" or
   carries a Docker id — a client that learned to depend on those would
   break the day a node ran something else, which is exactly what the
   runtime abstraction exists to prevent. A game's `install` says how it is
   installed, and today that is "image"; it is the game's word, not the
   runtime's, and it is one of the enumerations that may grow (docs/api.md). */

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
      /* The rest of what the panel's own form knows, so that a client can build the same form from this and not from a copy of the game:
         whether to mask it, whether it can still be changed, which builds it exists on (Project Zomboid has the same key twice, once for
         each, with different options), and the rules the panel enforces on a value. */
      help: f.help ?? null,
      secret: f.secret === true,
      fixedAfterCreation: f.fixedAfterCreation === true,
      lines: f.lines ?? null,
      minLength: f.minLength ?? null,
      maxLength: f.maxLength ?? null,
      pattern: f.pattern ?? null,
      requiredWhen: f.requiredWhen ?? null,
      // Drawn and written only while another setting has one of these values; and taken out of its file, not written empty, when empty.
      shownWhen: f.shownWhen ?? null,
      unsetWhenEmpty: f.unsetWhenEmpty === true,
      mustNotContain: f.mustNotContain ?? null,
      fromFiles: f.fromFiles ?? null,
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
    /* A lock is not a state: a locked backup is a complete one that cleanup skips and a delete refuses. The row keeps it as the state
       LOCKED, and until 0.11 the API said so, so that a client asking "is it complete?" had two answers to look for. */
    state: backup.state === "LOCKED" ? "COMPLETE" : backup.state,
    locked: backup.state === "LOCKED",
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

/** `showPayload` false: the text of a console command, to a reader who may not watch that console (see the audit log's rule in domain/access/commands.ts). */
export function taskShape(task: ScheduledTask & { server?: { slug: string } }, showPayload = true) {
  return {
    id: task.id,
    server: task.server?.slug ?? task.serverId,
    name: task.name,
    kind: task.kind,
    cron: task.cron,
    payload: showPayload ? task.payload : null,
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
    // Names are not unique evidence, the account is: null for the panel's own work and for an account that has been removed.
    actorId: event.userId,
    action: event.action,
    target: event.target,
    // Null above because the caller may not read this console's commands, not because there was none.
    targetHidden: event.targetHidden === true,
    // Lower case, as docs/api.md always said and as a notification's `tone` is: the column is the database's enum, and was sent as it.
    tone: event.tone.toLowerCase(),
    // A deleted server is still named, and says it is deleted.
    server: serverOfEvent(event),
    changes: event.changes,
    // The client a refused sign-in came from (0.11.0); null on every other line.
    ip: event.ip,
  };
}

/* How a server's DNS record stands, for the shape: `none` with no
   provider, `outside` for a host the provider's zone does not cover,
   `no-address` while its node has no public address, `set` with the
   address written, `failed` with why. The provider's facts and the
   node's addresses are the caller's to pass — a list looks them up once. */
export type ServerDnsShape = ReturnType<typeof dnsStateOf>;

export function serverShape(
  server: Server & { node: { name: string; region: string }; dnsRecords?: DnsRow[]; gameVersionRef: { slug: string } | null },
  dns?: { provider: { kind: DnsKind; zone: string } | null; node: { publicAddress: string | null; publicAddress6?: string | null; observedAddress: string | null } | null },
) {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const ports = game ? portsFor(game, server.port) : [];
  const view = dns ? dnsStateOf(server, dns.provider, dns.node, server.dnsRecords ?? []) : null;
  /* A record's `type`, the word the DNS webhook has always used for A, AAAA and SRV; `kind` is the name it had here until 0.11, kept for a
     client that reads it (docs/api-frozen.md, "Deprecated"). */
  const records = view ? { ...view, records: view.records.map((r) => ({ type: r.kind, ...r })) } : null;

  return {
    ...(records ? { dns: records } : {}),
    id: server.id,
    slug: server.slug,
    name: server.name,
    state: server.state,
    game: { id: server.gameId, family: server.game },
    /* The version's id is the catalog's: the one GET /games/:id/versions lists and POST /servers and …/update take. Until 0.11 it was the
       row's database id, which no route accepted. Null for a server whose version is no longer in the catalog. */
    version: { id: server.gameVersionRef?.slug ?? null, label: server.version },
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
    // An account's id, under a name that says so; `owner` is the name it had until 0.11, kept (docs/api-frozen.md, "Deprecated").
    ownerId: server.ownerId,
    owner: server.ownerId,
  };
}
