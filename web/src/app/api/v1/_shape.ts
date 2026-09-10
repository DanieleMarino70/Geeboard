import "server-only";
import type { Node, Server } from "@prisma/client";
import { findGame } from "@/domain/games/registry";
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

export function gameShape(game: GameDefinition) {
  return {
    id: game.id,
    name: game.name,
    family: game.family,
    blurb: game.blurb,
    official: game.official,
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
    /* Whether an agent is attached, never where it is or what it is
       reached with. The URL and the token stay on this side. */
    attached: Boolean(node.daemonUrl && node.daemonToken),
    lastSeenAt: node.lastSeenAt,
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

export function serverShape(server: Server & { node: { name: string; region: string } }) {
  const game = server.gameId ? findGame(server.gameId) : undefined;
  const ports = game ? portsFor(game, server.port) : [];

  return {
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
