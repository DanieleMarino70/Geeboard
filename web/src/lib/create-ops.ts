import "server-only";
import { Prisma } from "@prisma/client";
import type { Node, Server, User } from "@prisma/client";
import { asPlatformError } from "@/domain/errors";
import { applyTemplate, renderConfig } from "@/domain/games/config";
import { installServer, type InstallProgress } from "@/domain/games/install";
import { findGame, findTemplate, findVersion } from "@/domain/games/registry";
import { portsFor, strideOf, type GameDefinition } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { mapRuntimeState } from "@/domain/servers/state";
import { slugify } from "./catalog";
import { nextRun } from "./cron";
import { scheduleSettle } from "./daemon-sim";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* Creating a server.

   Every other operation in the panel changes something that already
   exists. This one commits a node's resources, claims a port nobody
   else can have, asks a runtime on another machine to bring a server
   into being, and writes a row — four things that can each fail on
   their own.

   So the shape of this file is: decide everything that can be decided
   before anything is written, then do the writing in an order where
   each step can be undone by the one that follows it. A create that
   fails leaves the workspace exactly as it found it. */

export interface CreateInput {
  name: string;
  host: string;
  gameId: string;
  versionId: string;
  templateId: string;
  nodeName: string;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
}

export type CreateResult = OpResult & { slug?: string };

/* ── Capacity ─────────────────────────────────────────────────────
   Against committed totals, not current usage. A node whose servers are
   idle still has its memory promised to them, and the moment they are
   busy is exactly when a naive placement would fall over. */

export interface Capacity {
  cpuCommitted: number;
  cpuTotal: number;
  ramCommitted: number;
  ramTotal: number;
  diskCommitted: number;
  diskTotal: number;
  servers: number;
}

export async function capacityOf(nodeId: string): Promise<Omit<Capacity, "cpuTotal" | "ramTotal" | "diskTotal">> {
  const sums = await db.server.aggregate({
    where: { nodeId },
    _sum: { cpuLimit: true, memoryLimit: true, diskQuota: true },
    _count: true,
  });
  return {
    cpuCommitted: sums._sum.cpuLimit ?? 0,
    ramCommitted: sums._sum.memoryLimit ?? 0,
    diskCommitted: sums._sum.diskQuota ?? 0,
    servers: sums._count,
  };
}

/** Everything the wizard needs to draw a node's placement card. */
export async function nodeCapacities(): Promise<Array<Capacity & {
  name: string;
  city: string;
  region: string;
  state: string;
  pingMs: number;
  hasAgent: boolean;
}>> {
  const nodes = await db.node.findMany({ orderBy: { pingMs: "asc" } });
  return Promise.all(
    nodes.map(async (node) => ({
      name: node.name,
      city: node.city,
      region: node.region,
      state: node.state,
      pingMs: node.pingMs,
      hasAgent: Boolean(node.daemonUrl && node.daemonToken),
      // A node's CPU ceiling is its cores expressed the way a server's
      // limit is: percent of one core.
      cpuTotal: node.cpuCores * 100,
      ramTotal: node.ramTotal,
      diskTotal: node.diskTotal,
      ...(await capacityOf(node.id)),
    })),
  );
}

/* ── Validation ───────────────────────────────────────────────────
   The wizard checks the same things as it goes, so reaching one of
   these means either a stale draft or something bypassing the UI. */

export function validateCreate(input: CreateInput): string | null {
  const name = input.name.trim();
  if (name.length < 2) return "The server name needs at least two characters.";
  if (name.length > 60) return "The server name is too long.";
  if (!slugify(name)) return "That name has no letters or digits in it.";

  const game = findGame(input.gameId);
  if (!game) return "Pick a game to host.";
  if (!findVersion(game, input.versionId)) return "Pick a version to run.";
  if (!findTemplate(game, input.templateId)) return "Pick a template to start from.";

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(input.host)) {
    return "That subdomain is not a valid hostname.";
  }

  const { memoryGb, cpuLimit, diskGb } = game.limits;
  if (!Number.isInteger(input.memoryGb) || input.memoryGb < memoryGb[0] || input.memoryGb > memoryGb[1]) {
    return `Memory must be between ${memoryGb[0]} and ${memoryGb[1]} GB for ${game.name}.`;
  }
  if (!Number.isInteger(input.cpuLimit) || input.cpuLimit < cpuLimit[0] || input.cpuLimit > cpuLimit[1]) {
    return `CPU must be between ${cpuLimit[0]}% and ${cpuLimit[1]}% for ${game.name}.`;
  }
  if (!Number.isInteger(input.diskGb) || input.diskGb < diskGb[0] || input.diskGb > diskGb[1]) {
    return `Storage must be between ${diskGb[0]} and ${diskGb[1]} GB for ${game.name}.`;
  }
  return null;
}

/* ── Allocation ───────────────────────────────────────────────────

   A game reserves a block of consecutive ports, and blocks are laid on
   a fixed stride so two servers can never interleave. Walking the
   stride also means the ports a server gets are the ones the review
   step showed, rather than three numbers picked from wherever. */

export async function freePortFor(game: GameDefinition, nodeId: string, skip: Set<number> = new Set()) {
  const taken = new Set(
    (await db.server.findMany({ where: { nodeId }, select: { port: true } })).map((s) => s.port),
  );
  const stride = strideOf(game);

  for (let base = game.portBase; base < game.portBase + game.portSpan; base += stride) {
    if (skip.has(base)) continue;
    // A block is only free if every port in it is.
    let clear = true;
    for (let offset = 0; offset < stride; offset++) {
      if (taken.has(base + offset)) {
        clear = false;
        break;
      }
    }
    if (clear) return base;
  }
  return null;
}

/** A free slug, since the name is the user's and the slug has to be unique. */
async function freeSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await db.server.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  // 99 servers sharing a name is not a case worth a cleverer scheme.
  return `${base}-${Date.now().toString(36)}`;
}

/* The domain the workspace's servers already sit under, so a new one
   gets an address that matches the others rather than a hardcoded
   guess. Falls back only on an empty workspace. */
export async function workspaceDomain(): Promise<string> {
  const servers = await db.server.findMany({ select: { host: true } });
  const counts = new Map<string, number>();
  for (const { host } of servers) {
    const domain = host.split(".").slice(1).join(".");
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  let best = "ashfold.gg";
  let seen = 0;
  for (const [domain, count] of counts) {
    if (count > seen) {
      best = domain;
      seen = count;
    }
  }
  return best;
}

/* ── The operation ────────────────────────────────────────────────── */

const MAX_PORT_ATTEMPTS = 5;

export async function createServerOp(user: User, input: CreateInput): Promise<CreateResult> {
  /* Creating commits a node's resources and takes a port off the pool.
     That is an infrastructure decision, so it sits with the roles that
     can drain a node rather than with everyone who owns a server. */
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return {
      ok: false,
      title: "Not permitted",
      body: "Only owners and admins can create servers.",
    };
  }

  const invalid = validateCreate(input);
  if (invalid) return { ok: false, title: "Check the form", body: invalid };

  const game = findGame(input.gameId)!;
  const version = findVersion(game, input.versionId)!;
  const template = findTemplate(game, input.templateId)!;
  const name = input.name.trim();

  /* The template's settings, as domain keys. What they become on the
     node — environment variables, lines in a config file — is decided
     once, at the runtime boundary, by renderConfig. */
  const config = applyTemplate(game, template.id);

  /* The catalog rows this server points at. Null when the catalog has
     not been synced yet, which is a link the panel can live without —
     the labels below are what the UI actually reads. */
  const catalogVersion = await db.gameVersion.findUnique({
    where: { gameId_slug: { gameId: game.id, slug: version.id } },
    select: { id: true, gameId: true, buildId: true },
  });

  /* What this version was at, at the moment it was installed. For a
     Steam game with no version number — Rust — this is the only thing
     that can later answer "has the branch moved?". Null when the catalog
     has not been synced or the game is not distributed that way. */
  const buildId = catalogVersion?.buildId ?? null;

  const node = await db.node.findUnique({ where: { name: input.nodeName } });
  if (!node) return { ok: false, title: "Cannot create", body: "That node no longer exists." };

  if (!node.approvedAt) {
    return {
      ok: false,
      title: `${node.name} is not approved`,
      body: "It has registered but nobody has approved it yet, so nothing can be placed there.",
    };
  }
  if (node.state === "DRAINING" || node.state === "MAINTENANCE") {
    return {
      ok: false,
      title: `${node.name} is ${node.state === "DRAINING" ? "draining" : "under maintenance"}`,
      body: "It is out of rotation, so it will not take new servers. Pick another node.",
    };
  }
  if (node.state === "UNREACHABLE") {
    return {
      ok: false,
      title: `${node.name} is unreachable`,
      body: "The panel cannot see it, so it cannot place a server on it.",
    };
  }

  const overCapacity = await capacityRefusal(node, input);
  if (overCapacity) return overCapacity;

  const taken = await db.server.findFirst({ where: { host: input.host }, select: { name: true } });
  if (taken) {
    return {
      ok: false,
      title: "Subdomain in use",
      body: `${input.host} already points at ${taken.name}.`,
    };
  }

  const slug = await freeSlug(name);

  /* ── Writing starts here ────────────────────────────────────────
     The row goes in first, because inserting it is what actually
     claims the port — the unique index turns a lost race into a
     failed insert instead of two servers on one address. Everything
     after this point has to undo it on the way out. */
  let server: Server | null = null;
  const tried = new Set<number>();

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const base = await freePortFor(game, node.id, tried);
    if (base === null) {
      return {
        ok: false,
        title: "No ports left",
        body: `${node.name} has no free ${game.name} port block in ${game.portBase}–${
          game.portBase + game.portSpan
        }.`,
      };
    }
    tried.add(base);

    try {
      server = await db.server.create({
        data: {
          slug,
          name,
          game: game.family,
          version: version.label,
          gameId: catalogVersion?.gameId ?? null,
          gameVersionId: catalogVersion?.id ?? null,
          art: game.art.split("\n")[0]!,
          state: "STOPPED",
          playersOn: 0,
          playersMax: game.defaults.playersMax,
          host: input.host,
          port: base,
          memoryLimit: input.memoryGb,
          cpuLimit: input.cpuLimit,
          diskQuota: input.diskGb,
          worldSize: "0 B",
          whitelist: template.whitelist,
          config,
          runtime: node.runtime,
          nodeId: node.id,
          ownerId: user.id,
        },
      });
      break;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      /* Somebody else got here first. Which unique constraint lost
         decides what to do: another port is worth trying, another slug
         or host is not — those were checked and are simply gone. */
      const constraint = JSON.stringify(error.meta?.target ?? "");
      if (!constraint.includes("port")) {
        return {
          ok: false,
          title: "Just taken",
          body: constraint.includes("host")
            ? `${input.host} was claimed by another server a moment ago.`
            : `The name ${name} was claimed by another server a moment ago.`,
        };
      }
      continue;
    }
  }

  if (!server) {
    return {
      ok: false,
      title: "Could not claim a port",
      body: `Another server took every port ${MAX_PORT_ATTEMPTS} attempts tried. Try again.`,
    };
  }

  /* ── The runtime ────────────────────────────────────────────────
     From here, any failure has to take the row with it. */
  const runtime = runtimeFor(node);

  if (!runtime) {
    /* No agent on this node, so there is nothing to provision. The
       server is real in the panel and simulated everywhere else, and
       it says so rather than pretending. */
    scheduleSettle(server.id, "STARTING", "RUNNING");
    await db.server.update({ where: { id: server.id }, data: { state: "STARTING" } });
    await recordCreation(user, server, node, game, version, template, true);

    return {
      ok: true,
      tone: "warning",
      title: `${name} created`,
      body: `${node.name} has no agent attached, so nothing was provisioned — this server is simulated.`,
      slug,
    };
  }

  const ports = portsFor(game, server.port);
  /* Install requirements, then the version's own variables, then the
     template's settings — so a setting the operator chose wins over a
     default the build ships with. Settings the game keeps in a file come
     back as patches, which the installer writes to the node. */
  const rendered = renderConfig(game, config, version);

  /* The state the panel owns while this runs. Reconciliation will not
     overwrite it, so a long install cannot be mistaken for a server that
     failed to start — see domain/servers/state.ts. */
  await db.server.update({ where: { id: server.id }, data: { state: "INSTALLING" } });

  try {
    const result = await installServer({
      game,
      runtime,
      files: rendered.files,
      plan: {
        serverId: server.id,
        name: slug,
        source: version.image,
        ports: ports.map((p) => ({
          label: p.label,
          host: p.host,
          container: p.container,
          protocol: p.protocol,
        })),
        memoryMb: input.memoryGb * 1024,
        cpuLimit: input.cpuLimit,
        env: { ...rendered.env, GEEBOARD_SERVER: slug },
        // The installer starts it after the config is written, not before.
        start: false,
      },
      report: (progress) => reportInstall(server.id, progress),
    });

    const state = mapRuntimeState(result.state);
    await db.server.update({
      where: { id: server.id },
      data: {
        runtimeId: result.ref.runtimeId,
        state,
        /* What this server was installed from. For a Steam game with no
           version number, this is the only thing that can later answer
           "has the branch moved?" — see domain/games/versions.ts. */
        installedBuildId: buildId,
        // Only a server that is actually up has an uptime to count from.
        startedAt: state === "RUNNING" ? new Date(result.startedAt ?? Date.now()) : null,
      },
    });
    await recordCreation(user, server, node, game, version, template, false);

    const configured =
      result.filesWritten > 0
        ? ` ${result.filesWritten} configuration file${result.filesWritten === 1 ? "" : "s"} written.`
        : "";

    return {
      ok: true,
      tone: "success",
      title: `${name} is up`,
      body: `${node.name} created it on ${input.host}:${server.port} and reports it ${state.toLowerCase()}.${configured}`,
      slug,
    };
  } catch (error) {
    /* installServer destroys what it made before it throws, but a
       timeout says nothing about how far the node got — so the rollback
       asks again by server id, which reaches a workload and a directory
       alike, and only then drops the row. */
    await runtime.destroy({ serverId: server.id, runtimeId: null }, true).catch(() => {});
    await db.server.delete({ where: { id: server.id } }).catch(() => {});

    const failure = asPlatformError(error);
    const step = typeof failure.details?.step === "string" ? ` while ${failure.details.step}` : "";
    return {
      ok: false,
      title: "Could not create the server",
      body: `${failure.message}${step}. Nothing was left behind on ${node.name}.`,
    };
  }
}

/* Installation progress, recorded where somebody can see it.

   Deliberately best-effort and deliberately not awaited into the
   critical path's failure handling: an install that worked must not be
   reported as failed because writing a progress row did not. */
async function reportInstall(serverId: string, progress: InstallProgress) {
  await db.activityEvent
    .create({
      data: {
        actor: "Installer",
        action: `server.install.${progress.step}`,
        target: progress.message,
        tone: "INFO",
        serverId,
      },
    })
    .catch(() => {});
}

/** Refuses a placement the node cannot honour, with the numbers. */
async function capacityRefusal(node: Node, input: CreateInput): Promise<CreateResult | null> {
  const used = await capacityOf(node.id);

  if (used.ramCommitted + input.memoryGb > node.ramTotal) {
    return {
      ok: false,
      title: `${node.name} is out of memory`,
      body: `${used.ramCommitted} of ${node.ramTotal} GB is already committed to ${used.servers} servers, so ${input.memoryGb} GB more will not fit.`,
    };
  }
  if (used.cpuCommitted + input.cpuLimit > node.cpuCores * 100) {
    return {
      ok: false,
      title: `${node.name} is out of CPU`,
      body: `${used.cpuCommitted / 100} of ${node.cpuCores} cores are already committed, so ${
        input.cpuLimit / 100
      } more will not fit.`,
    };
  }
  if (used.diskCommitted + input.diskGb > node.diskTotal) {
    return {
      ok: false,
      title: `${node.name} is out of storage`,
      body: `${used.diskCommitted} of ${node.diskTotal} GB is already committed, so ${input.diskGb} GB more will not fit.`,
    };
  }
  return null;
}

/* The audit trail, and the daily backup the review step promises. A
   server that says it is backed up nightly has to actually have the
   task, or the promise is decoration. */
async function recordCreation(
  user: User,
  server: Server,
  node: Node,
  game: GameDefinition,
  version: { label: string },
  template: { name: string },
  simulated: boolean,
) {
  await db.scheduledTask.create({
    data: {
      serverId: server.id,
      name: "Daily backup",
      kind: "BACKUP",
      cron: "0 3 * * *",
      enabled: true,
      nextRunAt: nextRun("0 3 * * *"),
    },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: simulated ? "server.created.simulated" : "server.created",
      target: server.name,
      tone: simulated ? "WARNING" : "SUCCESS",
      userId: user.id,
      serverId: server.id,
      changes: {
        Game: { from: "—", to: `${game.name} · ${version.label}` },
        Template: { from: "—", to: template.name },
        Node: { from: "—", to: node.name },
        Address: { from: "—", to: `${server.host}:${server.port}` },
        Resources: {
          from: "—",
          to: `${server.memoryLimit} GB · ${server.cpuLimit}% CPU · ${server.diskQuota} GB`,
        },
      },
    },
  });
}
