import "server-only";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import {
  currentConfig,
  planConfigChange,
  renderConfig,
  validateConfig,
  type ConfigPlan,
  type ConfigValues,
} from "@/domain/games/config";
import { installServer, writeConfigFiles } from "@/domain/games/install";
import { findGame, findVersion } from "@/domain/games/registry";
import { portsFor, type GameDefinition } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { mapRuntimeState } from "@/domain/servers/state";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* Applying a server's game settings.

   What a change *costs* is worked out in the domain — see
   planConfigChange — because it is arithmetic over a definition and
   belongs where it can be tested without a database. What is left here
   is the doing: writing the row, writing the files, and rebuilding the
   workload when a setting cannot be changed any other way. */

export type { ConfigChange, ConfigPlan } from "@/domain/games/config";
export { currentConfig, planConfigChange } from "@/domain/games/config";

export type ConfigResult = OpResult & { plan?: ConfigPlan };

export async function updateServerConfigOp(
  user: User,
  slug: string,
  values: ConfigValues,
  options: { recreate?: boolean } = {},
): Promise<ConfigResult> {
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return { ok: false, title: "Cannot save", body: "That server no longer exists." };

  if (!can(user, "server.settings.write", server.ownerId)) {
    return { ok: false, title: "Not permitted", body: "You cannot change this server's settings." };
  }

  const game = server.gameId ? findGame(server.gameId) : undefined;
  if (!game) {
    return {
      ok: false,
      title: "No game definition",
      body: "This server predates the game catalog, so its settings cannot be edited here yet.",
    };
  }

  const problems = validateConfig(game, values);
  const first = problems[0];
  if (first) {
    return { ok: false, title: "Check the form", body: `${first.label} ${first.message}.` };
  }

  const before = currentConfig(game, server);
  const after = { ...before, ...values };
  const plan = planConfigChange(game, before, after);

  if (plan.changes.length === 0) {
    return { ok: false, title: "Nothing to save", body: "No values were changed." };
  }

  /* Rebuilding a workload takes the server down. That is not something
     to do because a form was submitted, so it is asked for explicitly
     and the caller is told what it would cost. */
  if (plan.needsRecreate && !options.recreate) {
    return {
      ok: false,
      title: "This needs the server rebuilt",
      body: `${plan.changes
        .filter((c) => c.applies === "on-recreate")
        .map((c) => c.label)
        .join(", ")} can only change when the server is recreated. Its world is kept.`,
      plan,
    };
  }

  const runtime = runtimeFor(server.node);
  const rendered = renderConfig(game, after, versionOf(game, server), {
    /* On an update, an emptied field is a deliberate act — clearing a
       password has to be possible — where on a first install an empty
       value means "not set". */
    includeEmpty: true,
  });

  await db.server.update({ where: { id: server.id }, data: { config: after } });

  /* No agent: the settings are recorded and nothing else can happen.
     Saying so beats a success message for a write that did not occur. */
  if (!runtime || !server.runtimeId) {
    await record(user, server, plan);
    return {
      ok: true,
      tone: "warning",
      title: "Settings saved",
      body: `${server.node.name} has no agent attached, so nothing was written to the server itself.`,
      plan,
    };
  }

  const ref = { serverId: server.id, runtimeId: server.runtimeId };

  try {
    if (plan.needsRecreate) {
      await recreate(server, game, rendered.env, rendered.files, runtime);
    } else if (rendered.files.length > 0) {
      await writeConfigFiles(
        { game, runtime, plan: planStub(server), files: rendered.files, report: () => {} },
        ref,
      );
    }
  } catch (error) {
    const failure = asPlatformError(error);
    await db.server.update({
      where: { id: server.id },
      data: { state: "ERROR", lastError: failure.message },
    });
    return {
      ok: false,
      title: "Could not apply the settings",
      body: `${failure.message}. The values are saved; the server was not updated.`,
      plan,
    };
  }

  await record(user, server, plan);

  return {
    ok: true,
    tone: plan.needsRestart ? "warning" : "success",
    title: "Settings applied",
    body: plan.needsRecreate
      ? `${server.name} was rebuilt with the new settings. Its world is untouched.`
      : plan.needsRestart
        ? `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"} written. Some apply on the next restart.`
        : `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"} written.`,
    plan,
  };
}

/* Rebuilding a workload around new settings.

   The world survives because `destroy(ref, false)` leaves the data
   directory alone — the server's files live in the volume, not in the
   workload, which is the whole reason this is safe to do at all.

   The order matters, and so does the state: UPDATING is platform-owned,
   so reconciliation will not see a server with no workload and decide
   it has stopped. */
async function recreate(
  server: Server,
  game: GameDefinition,
  env: Record<string, string>,
  files: Awaited<ReturnType<typeof renderConfig>>["files"],
  runtime: NonNullable<ReturnType<typeof runtimeFor>>,
) {
  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  const ref = { serverId: server.id, runtimeId: server.runtimeId };
  await runtime.destroy(ref, false);

  const version = versionOf(game, server);
  const ports = portsFor(game, server.port);

  const result = await installServer({
    game,
    runtime,
    files,
    plan: {
      serverId: server.id,
      name: server.slug,
      source: version?.image ?? "",
      ports: ports.map((p) => ({
        label: p.label,
        host: p.host,
        container: p.container,
        protocol: p.protocol,
      })),
      memoryMb: server.memoryLimit * 1024,
      cpuLimit: server.cpuLimit,
      env: { ...env, GEEBOARD_SERVER: server.slug },
      start: false,
    },
    report: () => {},
  });

  const state = mapRuntimeState(result.state);
  await db.server.update({
    where: { id: server.id },
    data: {
      runtimeId: result.ref.runtimeId,
      state,
      lastError: null,
      startedAt: state === "RUNNING" ? new Date(result.startedAt ?? Date.now()) : null,
    },
  });
}

/* The version a server is running, from the catalog link. Null on a
   server that predates it, which is why recreate refuses without one:
   rebuilding a workload with no idea what to run it from would replace
   a working server with nothing. */
function versionOf(game: GameDefinition, server: Pick<Server, "version">) {
  return game.versions.find((v) => v.label === server.version) ?? findVersion(game, game.versions[0]!.id);
}

function planStub(server: Server) {
  // writeConfigFiles only reads the server id off the plan; the rest is
  // provisioning detail it has no use for.
  return {
    serverId: server.id,
    name: server.slug,
    source: "",
    ports: [],
    memoryMb: server.memoryLimit * 1024,
    cpuLimit: server.cpuLimit,
    env: {},
    start: false,
  };
}

async function record(user: User, server: Server, plan: ConfigPlan) {
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.config.updated",
      target: server.name,
      tone: plan.needsRecreate ? "WARNING" : "ACCENT",
      userId: user.id,
      serverId: server.id,
      changes: Object.fromEntries(
        plan.changes.map((c) => [c.label, { from: String(c.from), to: String(c.to) }]),
      ),
    },
  });
}
