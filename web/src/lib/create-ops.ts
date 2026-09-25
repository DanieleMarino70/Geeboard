import "server-only";
import { Prisma } from "@prisma/client";
import type { Node, Server, User } from "@prisma/client";
import { asPlatformError } from "@/domain/errors";
import { applyTemplate, renderConfig, scopeToLine, validateConfig, type ConfigValues } from "@/domain/games/config";
import { installServer, type InstallStep } from "@/domain/games/install";
import { findGame, findTemplate, findVersion } from "@/domain/games/registry";
import { strideOf, type CapabilityId, type GameDefinition } from "@/domain/games/types";
import { workloadPlan, workloadSpec } from "@/domain/games/workload";
import { versionMessage } from "@/domain/nodes/agent-version";
import { cannotRun, checkCompatibility, type NodeProfile } from "@/domain/nodes/compatibility";
import { runtimeFor } from "@/domain/runtime/docker";
import { PLATFORM_FLOOR } from "@/lib/settings-rules";
import { mapRuntimeState } from "@/domain/servers/state";
import { keepHistoryOf } from "./audit";
import { slugify } from "./catalog";
import { nextRun } from "./cron";
import { scheduleSettle } from "./daemon-sim";
import { db } from "./db";
import { STEP_WORDS, beginProgress, installReporter } from "./install-progress";
import type { OpResult } from "./server-ops";
import { PANEL_VERSION } from "./version";

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
  /* The operator's own settings over the template's, by domain key.
     Absent or empty means the template as it is. This is the only time
     a `fixedAfterCreation` setting — a world's rules — can be chosen. */
  config?: ConfigValues;
  nodeName: string;
  memoryGb: number;
  cpuLimit: number;
  diskGb: number;
  /* A key the caller made up, to ask how the install is going while this
     call is still running — see installProgressOf. Ignored unless it
     looks like one. */
  progressKey?: string;
  /* Place this server on a node that does not have the memory or CPU
     left for it, deliberately.

     Both are ceilings on what a server may take rather than what it
     does take, and an operator who has measured their own servers may
     promise more than the machine has on purpose. So this is a decision
     the panel takes from somebody rather than one it makes: asked for
     per creation, never remembered, never a default, and recorded as
     `server.overcommitted` with the numbers. Storage is not included —
     capacityRefusal says why. */
  overcommit?: boolean;
}

export type CreateResult = OpResult & { slug?: string };

/* Where an install has got to is lib/install-progress.ts: the steps are
   the installer's own, and while downloading, the layers and bytes the
   node counted — a bar only when those numbers support one. */

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

/* Every node, in the shape the placement engine reads.

   Committed figures come from the servers actually placed, not from a
   counter somebody has to remember to update — a stored total drifts,
   and a drifted total is a placement that overcommits a machine. */
export async function nodeProfiles(): Promise<NodeProfile[]> {
  const nodes = await db.node.findMany({ orderBy: { pingMs: "asc" } });
  return Promise.all(nodes.map(profileOf));
}

/** One node, in the shape the compatibility engine reads. */
export async function profileOf(node: Node): Promise<NodeProfile> {
  const committed = await capacityOf(node.id);
  return {
    name: node.name,
    region: node.region,
    state: node.state,
    pingMs: node.pingMs,
    // A value the node has not reported stays null: unknown is not
    // the same as wrong, and the engine treats them differently.
    os: node.os === "linux" || node.os === "windows" ? node.os : null,
    arch: node.arch === "x64" || node.arch === "arm64" ? node.arch : null,
    capabilities: node.capabilities as CapabilityId[],
    cpuTotalPct: node.cpuCores * 100,
    ramTotalGb: node.ramTotal,
    diskTotalGb: node.diskTotal,
    cpuCommittedPct: committed.cpuCommitted,
    ramCommittedGb: committed.ramCommitted,
    diskCommittedGb: committed.diskCommitted,
    servers: committed.servers,
    // For placement's anti-affinity: which games are here, and whose.
    hosted: await db.server.findMany({ where: { nodeId: node.id }, select: { gameId: true, ownerId: true } }),
    hasAgent: Boolean(node.daemonUrl && node.daemonToken),
    /* The release line, decided here because this is the layer that
       knows what version the panel is. `daemon` is the column holding
       what the node last reported. */
    agentVersionMismatch: versionMessage(PANEL_VERSION, node.daemon),
  };
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
  const version = findVersion(game, input.versionId);
  if (!version) return "Pick a version to run.";
  if (version.supported === false) return `Geeboard no longer installs ${version.label}.`;
  if (!findTemplate(game, input.templateId)) return "Pick a template to start from.";

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(input.host)) {
    return "That address is not a valid hostname.";
  }

  /* Memory and CPU are bounded below by the platform rather than by the
     game: under what a game asks for is the operator's decision, said out
     loud where it is made and not refused here — see PLATFORM_FLOOR and
     settingsWarnings. Storage keeps the game's floor, because a disk too
     small to hold the image is not a slow server, it is a download that
     cannot finish. */
  const { memoryGb, cpuLimit, diskGb } = game.limits;
  if (
    !Number.isInteger(input.memoryGb) ||
    input.memoryGb < PLATFORM_FLOOR.memoryGb ||
    input.memoryGb > memoryGb[1]
  ) {
    return `Memory must be between ${PLATFORM_FLOOR.memoryGb} and ${memoryGb[1]} GB for ${game.name}.`;
  }
  if (
    !Number.isInteger(input.cpuLimit) ||
    input.cpuLimit < PLATFORM_FLOOR.cpuLimit ||
    input.cpuLimit > cpuLimit[1]
  ) {
    return `CPU must be between ${PLATFORM_FLOOR.cpuLimit}% and ${cpuLimit[1]}% for ${game.name}.`;
  }
  if (!Number.isInteger(input.diskGb) || input.diskGb < diskGb[0] || input.diskGb > diskGb[1]) {
    return `Storage must be between ${diskGb[0]} and ${diskGb[1]} GB for ${game.name}.`;
  }

  /* Against the version's own settings: a key the line does not have
     is a setting the game would never read, and the same refusal the
     settings page gives. */
  if (input.config) {
    const problem = validateConfig(scopeToLine(game, version.line), input.config)[0];
    if (problem) return `${problem.label} ${problem.message}.`;
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

  /* The template's settings, as domain keys, with the operator's own
     over them. What they become on the node — environment variables,
     lines in a config file — is decided once, at the runtime boundary,
     by renderConfig. Narrowed to the version's line, so a build 41
     server stores build 41's settings and nothing of build 42's. */
  const scoped = scopeToLine(game, version.line);
  const config = { ...applyTemplate(scoped, template.id), ...(input.config ?? {}) };

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

  const over = await capacityOver(node, input);
  const overCapacity = await capacityRefusal(node, input, { overcommit: input.overcommit });
  if (overCapacity) return overCapacity;

  /* Whether the game can run there at all. The wizard only ever
     recommended against a node that could not — creation went ahead
     anyway, and a Linux image landed on a node that had said it runs
     Windows containers, or a SteamCMD game on one that had not agreed to
     host one. A node that has not reported its platform or capabilities
     is not refused on a guess; `cannotRun` only names what it said. */
  const cannot = cannotRun(
    checkCompatibility(game, await profileOf(node), {
      memoryGb: input.memoryGb,
      cpuLimit: input.cpuLimit,
      diskGb: input.diskGb,
    }),
  );
  if (cannot.length > 0) {
    return {
      ok: false,
      title: `${node.name} cannot run ${game.name}`,
      body: cannot.join(" "),
    };
  }

  const taken = await db.server.findFirst({ where: { host: input.host }, select: { name: true } });
  if (taken) {
    return {
      ok: false,
      title: "Address in use",
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
    await recordCreation(user, server, node, game, version, template, true, over);

    return {
      ok: true,
      tone: "warning",
      title: `${name} created`,
      body: `${node.name} has no agent attached, so nothing was provisioned — this server is simulated.`,
      slug,
    };
  }

  /* Install requirements, then the version's own variables, then the
     template's settings — so a setting the operator chose wins over a
     default the build ships with. Settings the game keeps in a file come
     back as patches, which the installer writes to the node. */
  // The one render that writes the world's rules — see RenderOptions.creating.
  const rendered = renderConfig(scoped, config, version, { creating: true });

  /* The state the panel owns while this runs. Reconciliation will not
     overwrite it, so a long install cannot be mistaken for a server that
     failed to start — see domain/servers/state.ts. */
  await db.server.update({ where: { id: server.id }, data: { state: "INSTALLING" } });
  /* On its own, and allowed to fail: a key somebody reused is a wizard
     with no progress to show, not a server that cannot be created. */
  await beginProgress(server.id, input.progressKey, "prepare", `Preparing ${game.name}`);

  try {
    const plan = workloadPlan(
      game,
      version,
      { id: server.id, slug, port: server.port, memoryGb: input.memoryGb, cpuLimit: input.cpuLimit },
      rendered,
    );
    const result = await installServer({
      game,
      runtime,
      files: rendered.files,
      plan,
      report: installReporter(server.id),
    });

    const state = mapRuntimeState(result.state);
    await db.server.update({
      where: { id: server.id },
      data: {
        runtimeId: result.ref.runtimeId,
        state,
        // What it was made from, for noticing later that it would be made differently.
        builtSpec: workloadSpec(plan, game) as unknown as Prisma.InputJsonValue,
        installKey: null,
        installStep: null,
        installMessage: null,
        installDetail: Prisma.DbNull,
        /* What this server was installed from. For a Steam game with no
           version number, this is the only thing that can later answer
           "has the branch moved?" — see domain/games/versions.ts. */
        installedBuildId: buildId,
        // Only a server that is actually up has an uptime to count from.
        startedAt: state === "RUNNING" ? new Date(result.startedAt ?? Date.now()) : null,
      },
    });
    await recordCreation(user, server, node, game, version, template, false, over);

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
    /* It used to say "Nothing was left behind" whether the node answered
       this or not — and a node that has stopped answering is one way a
       create fails. */
    const cleaned = await runtime.destroy({ serverId: server.id, runtimeId: null }, true).then(
      () => true,
      () => false,
    );
    const afterwards = cleaned
      ? `Nothing was left behind on ${node.name}.`
      : `${node.name} did not answer when asked to remove what it had made, so something of ${name} may be left there.`;

    const failure = asPlatformError(error);
    const at = failure.details?.step;
    const words = typeof at === "string" && at in STEP_WORDS ? STEP_WORDS[at as InstallStep] : "";
    const step = words ? ` ${words}` : "";

    /* The row goes; what happened stays. The steps the install reported
       on its way are already in the log, and this line says where it
       stopped and why. Both used to go with the row, which is why the
       first create of a large image to fail on this project's machine
       left nothing behind to read. */
    await db
      .$transaction([
        db.activityEvent.create({
          data: {
            actor: user.name,
            action: "server.create.failed",
            target: name,
            tone: "DANGER",
            userId: user.id,
            serverId: server.id,
            changes: {
              Game: { from: "—", to: `${game.name} · ${version.label}` },
              Node: { from: "—", to: node.name },
              Step: { from: "—", to: typeof at === "string" ? at : "—" },
              Reason: { from: "—", to: failure.message },
              Afterwards: { from: "—", to: afterwards },
            },
          },
        }),
        keepHistoryOf(server),
        db.server.delete({ where: { id: server.id } }),
      ])
      // Whatever the log could not keep, the row still has to go.
      .catch(() => db.server.delete({ where: { id: server.id } }).catch(() => {}));
    return {
      ok: false,
      title: "Could not create the server",
      body: `${failure.message.replace(/\.$/, "")}${step}. ${afterwards}`,
    };
  }
}

/* By how much this placement would put a node past what it has. Zero on
   every line means it fits; the numbers are what a refusal quotes, and
   what an overcommit is recorded as. */
export interface CapacityOver {
  /** GB of memory past the node's total, after this server. */
  ramGb: number;
  /** Hundredths of a core past the node's total. */
  cpuPct: number;
  /** GB of storage past the node's total. */
  diskGb: number;
  ramCommitted: number;
  cpuCommitted: number;
  diskCommitted: number;
  servers: number;
}

export async function capacityOver(
  node: Node,
  input: Pick<CreateInput, "memoryGb" | "cpuLimit" | "diskGb">,
): Promise<CapacityOver> {
  const used = await capacityOf(node.id);
  return {
    ramGb: Math.max(0, used.ramCommitted + input.memoryGb - node.ramTotal),
    cpuPct: Math.max(0, used.cpuCommitted + input.cpuLimit - node.cpuCores * 100),
    diskGb: Math.max(0, used.diskCommitted + input.diskGb - node.diskTotal),
    ramCommitted: used.ramCommitted,
    cpuCommitted: used.cpuCommitted,
    diskCommitted: used.diskCommitted,
    servers: used.servers,
  };
}

/* Whether a node has room for one more server of this size. Shared with
   moving a server, which is a placement too — the same refusal, in the
   same words, whichever way a server arrives on a node.

   `overcommit` is the operator saying they know: memory and CPU are
   ceilings on what a server may take, not what it does take, and
   somebody who has measured their own servers may deliberately promise
   more than the machine has. It is asked for explicitly, per creation,
   and recorded — see createServerOp.

   **Storage is not overcommittable**, and that asymmetry is deliberate.
   A memory ceiling past the machine's means the kernel kills the server
   that asks for too much, and a CPU one means everything runs slower;
   both are recoverable, and both are the operator's to judge. A disk
   that fills stops every world on the node mid-write, including the ones
   belonging to people who did not make this choice — and a backup taken
   while a disk is full is a backup of a truncated save. */
export async function capacityRefusal(
  node: Node,
  input: Pick<CreateInput, "memoryGb" | "cpuLimit" | "diskGb">,
  options: { overcommit?: boolean } = {},
): Promise<CreateResult | null> {
  const over = await capacityOver(node, input);

  if (over.ramGb > 0 && !options.overcommit) {
    return {
      ok: false,
      title: `${node.name} is out of memory`,
      body: `${over.ramCommitted} of ${node.ramTotal} GB is already committed to ${over.servers} servers, so ${input.memoryGb} GB more will not fit.`,
    };
  }
  if (over.cpuPct > 0 && !options.overcommit) {
    return {
      ok: false,
      title: `${node.name} is out of CPU`,
      body: `${over.cpuCommitted / 100} of ${node.cpuCores} cores are already committed, so ${
        input.cpuLimit / 100
      } more will not fit.`,
    };
  }
  if (over.diskGb > 0) {
    return {
      ok: false,
      title: `${node.name} is out of storage`,
      body: options.overcommit
        ? `${over.diskCommitted} of ${node.diskTotal} GB is already committed, so ${input.diskGb} GB more will not fit. Memory and CPU can be overcommitted; storage cannot — a full disk stops every world on this node, not only this one.`
        : `${over.diskCommitted} of ${node.diskTotal} GB is already committed, so ${input.diskGb} GB more will not fit.`,
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
  over?: CapacityOver,
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

  /* An overcommit is its own line in the log, not a footnote on the
     creation. Somebody reading this node's history six months from now,
     wondering why its servers are being killed for memory, should find
     the decision and its numbers rather than infer them. */
  if (over && (over.ramGb > 0 || over.cpuPct > 0)) {
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.overcommitted",
        target: server.name,
        tone: "WARNING",
        userId: user.id,
        serverId: server.id,
        changes: {
          Node: { from: "—", to: node.name },
          Memory: {
            from: `${node.ramTotal} GB on the machine`,
            to: `${over.ramCommitted + server.memoryLimit} GB committed${over.ramGb > 0 ? ` · ${over.ramGb} GB over` : ""}`,
          },
          CPU: {
            from: `${node.cpuCores} cores on the machine`,
            to: `${(over.cpuCommitted + server.cpuLimit) / 100} cores committed${
              over.cpuPct > 0 ? ` · ${over.cpuPct / 100} over` : ""
            }`,
          },
        },
      },
    });
  }
}
