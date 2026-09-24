import "server-only";
import { Prisma } from "@prisma/client";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import {
  configFilesOf,
  currentConfig,
  planConfigChange,
  readConfigValues,
  renderConfig,
  scopeToLine,
  validateConfig,
  type ConfigFileContents,
  type ConfigPlan,
  type ConfigValues,
} from "@/domain/games/config";
import { writeConfigFiles } from "@/domain/games/install";
import { findGame, versionOfServer } from "@/domain/games/registry";
import type { GameDefinition, GameVersion } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { db } from "./db";
import type { OpResult } from "./server-ops";
import { agentLineRefusal, rebuildWorkload, wasRunning } from "./update-ops";

/* Applying a server's game settings.

   What a change *costs* is worked out in the domain — see
   planConfigChange — because it is arithmetic over a definition and
   belongs where it can be tested without a database. What is left here
   is the doing: writing the row, writing the files, and rebuilding the
   workload when a setting cannot be changed any other way. */

export type { ConfigChange, ConfigDrift, ConfigPlan } from "@/domain/games/config";
export { currentConfig, planConfigChange } from "@/domain/games/config";

/* What the server's own files say, as opposed to what the panel last
   wrote. Read before the settings form is drawn, so a value changed on
   the node — through the Files page, or by the game itself on boot — is
   what the form shows and not something a save would quietly undo.

   Everything here is best-effort: a node that cannot be reached, a file
   that does not exist yet, a file too large to read. Any of those simply
   means the form falls back to the stored settings, which is what it
   always used to show. */
export async function configOnNode(
  server: Server & { node: { name: string; daemonUrl: string | null; daemonToken: string | null } },
  game: GameDefinition,
): Promise<{ values: ConfigValues; read: boolean }> {
  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) return { values: {}, read: false };

  const ref = { serverId: server.id, runtimeId: server.runtimeId };
  const files: ConfigFileContents[] = [];
  let read = false;

  for (const path of configFilesOf(game)) {
    try {
      const file = await runtime.files.read(ref, path);
      // A truncated read is a partial file; parsing it would invent absences.
      if (file.truncated) continue;
      files.push({ path, content: file.content });
      read = true;
    } catch {
      /* Not there yet, or the node is not answering. Either way there is
         nothing to show from it. */
    }
  }

  return { values: readConfigValues(game, files), read };
}

export type ConfigResult = OpResult & { plan?: ConfigPlan };

export async function updateServerConfigOp(
  user: User,
  slug: string,
  values: ConfigValues,
  options: { recreate?: boolean } = {},
): Promise<ConfigResult> {
  const server = await db.server.findUnique({
    where: { slug },
    include: {
      node: { select: { name: true, daemonUrl: true, daemonToken: true, daemon: true } },
      gameVersionRef: { select: { slug: true } },
    },
  });
  if (!server) return { ok: false, title: "Cannot save", body: "That server no longer exists." };

  if (!can(user, "server.settings.write", server.ownerId)) {
    return { ok: false, title: "Not permitted", body: "You cannot change this server's settings." };
  }

  const definition = server.gameId ? findGame(server.gameId) : undefined;
  if (!definition) {
    return {
      ok: false,
      title: "No game definition",
      body: "This server predates the game catalog, so its settings cannot be edited here yet.",
    };
  }
  // The version's own settings, the same narrowing the form was drawn with.
  const game = scopeToLine(definition, versionOf(definition, server)?.line);

  const problems = validateConfig(game, values);
  const first = problems[0];
  if (first) {
    return { ok: false, title: "Check the form", body: `${first.label} ${first.message}.` };
  }

  const before = currentConfig(game, server);

  /* The form shows a fixed setting as the server's file has it, and
     sends back what it showed. That is not a request to change it: the
     file is the world's rules, edited by hand or rewritten by the game,
     and a save of some other setting must not be refused because the
     rules moved on since creation. So a fixed value that matches the
     file is taken as the stored one; only a value that matches neither
     is a change, and is refused below. */
  const fixedKeys = game.config.filter((f) => f.fixedAfterCreation).map((f) => f.key);
  if (fixedKeys.some((key) => key in values && values[key] !== before[key])) {
    const onNode = (await configOnNode(server, game)).values;
    for (const key of fixedKeys) {
      if (key in values && values[key] !== before[key] && values[key] === onNode[key]) values[key] = before[key]!;
    }
  }

  const after = { ...before, ...values };
  const plan = planConfigChange(game, before, after);

  if (plan.changes.length === 0) {
    return { ok: false, title: "Nothing to save", body: "No values were changed." };
  }

  /* A value the game reads only when the world is made. Rebuilding the
     server for it would take the server down and change nothing. */
  const fixed = plan.changes.filter((c) => game.config.find((f) => f.key === c.key)?.fixedAfterCreation);
  if (fixed.length > 0) {
    return {
      ok: false,
      title: "Set when the world was created",
      body: `${fixed.map((c) => c.label).join(", ")} only applies to a new world. This server's world already exists.`,
    };
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

  /* A rebuild installs the server afresh, from its version. With no
     version to install from — or one Geeboard no longer installs — it
     would destroy a working workload and put nothing back, so it is
     refused here, before anything has been written. */
  const version = versionOf(game, server);
  if (plan.needsRecreate && (!version || version.supported === false)) {
    return {
      ok: false,
      title: "Cannot rebuild this server",
      body: version
        ? `Geeboard no longer installs ${version.label}, so the server cannot be rebuilt around the new settings.`
        : `Geeboard cannot tell which version ${server.name} is on, so it cannot rebuild it around the new settings.`,
      plan,
    };
  }
  // The rebuild an update runs, refused the same way, before anything is written.
  const behind = plan.needsRecreate ? agentLineRefusal(server.node) : null;
  if (behind) return { ok: false, title: "Upgrade the agent first", body: behind, plan };

  const runtime = runtimeFor(server.node);
  const rendered = renderConfig(game, after, version, {
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

  if (plan.needsRecreate && version) {
    return recreate(user, server, game, version, runtime, ref, { before, after, plan });
  }

  try {
    if (rendered.files.length > 0) {
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
/* And it goes through the same rebuild an update does, with the same way
   back. A workload that will not start with the new settings is
   unambiguous, so it is undone without asking: the workload is made again
   from the settings it had, which are known to start, and the stored
   settings go back with it — a form that showed values the server is not
   running on would be the panel saying something it knows to be false.

   This used to be a copy of the rebuild with no way back: a bad value
   left the server in ERROR with a Rebuild button that failed the same way
   until somebody worked out which setting to put back. The world is not
   touched either way, so there is no backup to take. */
async function recreate(
  user: User,
  server: Server,
  game: GameDefinition,
  version: GameVersion,
  runtime: NonNullable<ReturnType<typeof runtimeFor>>,
  ref: { serverId: string; runtimeId: string | null },
  change: { before: ConfigValues; after: ConfigValues; plan: ConfigPlan },
): Promise<ConfigResult> {
  const running = await wasRunning(runtime, ref, server);
  await db.server.update({ where: { id: server.id }, data: { state: "UPDATING" } });

  try {
    await rebuildWorkload({ ...server, config: change.after }, game, version, runtime, ref, running, { proveItStarts: true });
    await db.server.update({ where: { id: server.id }, data: { lastError: null } });
  } catch (error) {
    const failure = asPlatformError(error);
    const previous = server.config as Prisma.InputJsonValue | null;

    /* The download comes before anything is touched, and one that failed
       left the old workload as it was, on the settings it had. Putting it
       back would be the same download failing again, after which a server
       that never stopped was called broken. */
    const untouched = failure.details?.untouched === true;
    const recovered =
      untouched ||
      (await rebuildWorkload(server, game, version, runtime, { ...ref, runtimeId: null }, running, { proveItStarts: true })
        .then(() => true)
        .catch(() => false));

    await db.server.update({
      where: { id: server.id },
      data: untouched
        ? { config: previous ?? Prisma.DbNull, state: server.state }
        : recovered
          ? { config: previous ?? Prisma.DbNull, state: running ? "STARTING" : "STOPPED", lastError: null }
          : { state: "ERROR", lastError: `Settings rebuild failed: ${failure.message}` },
    });
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.config.failed",
        target: server.name,
        tone: "DANGER",
        userId: user.id,
        serverId: server.id,
        changes: {
          ...Object.fromEntries(change.plan.changes.map((c) => [c.label, { from: String(c.from), to: String(c.to) }])),
          Reason: { from: "—", to: failure.message },
          Outcome: {
            from: "—",
            to: untouched ? "nothing was changed" : recovered ? "put back on the previous settings" : "could not be put back",
          },
        },
      },
    });

    return {
      ok: false,
      title: "Could not apply the settings",
      body: untouched
        ? `${failure.message}. Nothing was changed: ${server.name} is as it was, and the form shows its settings again.`
        : recovered
          ? `${failure.message}. ${server.name} was rebuilt on the settings it had before, and the form shows those again. Its world is untouched.`
          : `${failure.message}. ${server.name} could not be put back on its previous settings either and needs looking at; the new values are saved and its world is intact.`,
      plan: change.plan,
    };
  }

  await record(user, server, change.plan);
  return {
    ok: true,
    tone: "warning",
    title: "Settings applied",
    body: `${server.name} was rebuilt with the new settings${running ? "" : ", and left stopped as it was"}. Its world is untouched.`,
    plan: change.plan,
  };
}

/* The version a server is running, from the catalog link. Undefined on a
   server that resolves to nothing, which is why a rebuild refuses without
   one: rebuilding a workload with no idea what to run it from would
   replace a working server with nothing.

   This used to fall back to the definition's first version. That is a
   guess, and after Zomboid's versions were reordered it would have
   rebuilt a build 41 world on build 42. */
function versionOf(
  game: GameDefinition,
  server: Pick<Server, "version"> & { gameVersionRef: { slug: string } | null },
) {
  return versionOfServer(game, {
    versionSlug: server.gameVersionRef?.slug,
    versionLabel: server.version,
  });
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
    args: [],
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
