import "server-only";
import type { Server, User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import { currentConfig, renderConfig, scopeToLine } from "@/domain/games/config";
import { writeConfigFiles } from "@/domain/games/install";
import { requireGame, versionOfServer } from "@/domain/games/registry";
import type { GameDefinition, ModSupport } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { isUp } from "@/domain/servers/state";
import { createBackupOp } from "./backup-ops";
import { db } from "./db";
import type { OpResult } from "./server-ops";
import { searchWorkshop, workshopDetails, workshopIdFrom, workshopSearchAvailable, type WorkshopItem } from "./workshop";

/* Mods on a server.

   The shape of this follows what the game actually does, which for
   Project Zomboid is: read two keys out of its own settings file on
   every start, download whatever Workshop ids the first one lists, and
   load whatever mod ids the second one lists. Nothing else is involved —
   no package manager, no registry of ours, and no byte of a mod passing
   through the panel.

   So the panel's job is to keep a list, write those two keys, and be
   honest about the three states a mod can be in:

     chosen      a row here; the game has not been told yet
     downloaded  the node has the files, and told us what is inside them
     loaded      its mod ids are in the game's load list

   The gap between the first two is a restart, and the gap between the
   second and third is why the mod ids are read off the node rather than
   guessed from a Workshop description: one Workshop item can carry
   several mods, and the name the game loads them by lives in a
   `mod.info` inside the download. A load list naming a mod that is not
   there is a Zomboid server that refuses to start. */

export interface ModRow {
  id: string;
  workshopId: string;
  title: string;
  previewUrl: string | null;
  sizeBytes: number;
  /** What the node found inside the download. Empty until it has one. */
  modIds: string[];
  enabled: boolean;
  position: number;
  addedBy: string | null;
  addedAt: Date;
}

export interface ModsView {
  /** Null when this game takes no mods, which the panel says rather than hiding. */
  support: ModSupport | null;
  game: string;
  /** Whether this installation can browse the Workshop, or only take links. */
  searchAvailable: boolean;
  mods: ModRow[];
  /** The chosen list differs from what the game was last told. */
  pending: boolean;
  /** Mods whose downloads the node has not reported yet. */
  awaitingDownload: number;
  serverState: string;
  /** False when the node has no agent: nothing can be written or read. */
  attached: boolean;
}

type ServerWithNode = Server & { node: { name: string; daemonUrl: string | null; daemonToken: string | null } };

async function load(slug: string): Promise<ServerWithNode | null> {
  return db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
}

function supportOf(server: Pick<Server, "gameId">): { game: GameDefinition; support: ModSupport } | null {
  if (!server.gameId) return null;
  try {
    const game = requireGame(server.gameId);
    return game.mods ? { game, support: game.mods } : null;
  } catch {
    /* A server whose definition has been retired keeps running; it just
       has nothing here to offer. */
    return null;
  }
}

function rowOf(mod: {
  id: string;
  workshopId: string;
  title: string;
  previewUrl: string | null;
  sizeBytes: number;
  modIds: string[];
  enabled: boolean;
  position: number;
  addedAt: Date;
  addedBy: { name: string } | null;
}): ModRow {
  return { ...mod, addedBy: mod.addedBy?.name ?? null };
}

/** What the game should be told, from what the operator has chosen. */
function wanted(mods: ModRow[]): { items: string[]; enabled: string[] } {
  const ordered = [...mods].sort((a, b) => a.position - b.position);
  return {
    /* Every item is downloaded, including the ones switched off: a mod
       turned off and on again should not be a five-minute download. */
    items: ordered.map((mod) => mod.workshopId),
    enabled: ordered.filter((mod) => mod.enabled).flatMap((mod) => mod.modIds),
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export async function modsView(user: User, slug: string): Promise<ModsView | null> {
  const server = await load(slug);
  if (!server || !can(user, "server.read", server.ownerId)) return null;

  const found = supportOf(server);
  const mods = (
    await db.serverMod.findMany({
      where: { serverId: server.id },
      orderBy: { position: "asc" },
      include: { addedBy: { select: { name: true } } },
    })
  ).map(rowOf);

  const should = wanted(mods);

  return {
    support: found?.support ?? null,
    game: server.game,
    searchAvailable: workshopSearchAvailable(),
    mods,
    pending:
      !sameList(should.items, server.modItemsApplied) || !sameList(should.enabled, server.modIdsApplied),
    awaitingDownload: mods.filter((mod) => mod.modIds.length === 0).length,
    serverState: server.state,
    attached: Boolean(server.node.daemonUrl && server.node.daemonToken),
  };
}

/* ── Choosing ─────────────────────────────────────────────────────
   Nothing here touches the node. A mod is chosen, then applied, and the
   panel says which of the two has happened. */

async function reach(
  user: User,
  slug: string,
): Promise<{ ok: true; server: ServerWithNode; support: ModSupport; game: GameDefinition } | { ok: false; result: OpResult }> {
  const server = await load(slug);
  if (!server) return { ok: false, result: { ok: false, title: "Cannot do that", body: "That server no longer exists." } };

  if (!can(user, "server.settings.write", server.ownerId)) {
    return {
      ok: false,
      result: { ok: false, title: "Not permitted", body: "You cannot change this server's settings." },
    };
  }

  const found = supportOf(server);
  if (!found) {
    return {
      ok: false,
      result: {
        ok: false,
        title: "No mods for this game",
        body: `Geeboard does not install mods for ${server.game}. Project Zomboid is the one that can, for now.`,
      },
    };
  }

  return { ok: true, server, support: found.support, game: found.game };
}

export type SearchResult = OpResult & {
  items?: WorkshopItem[];
  more?: boolean;
  /** Which of these are already on this server. */
  chosen?: string[];
};

export async function searchModsOp(
  user: User,
  slug: string,
  text: string,
  page = 1,
): Promise<SearchResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;

  const chosen = (await db.serverMod.findMany({ where: { serverId: reached.server.id }, select: { workshopId: true } }))
    .map((mod) => mod.workshopId);

  /* A pasted link is not a search: an operator who has an id in hand
     gets that item back whether or not this installation has a Steam
     key, which is the difference between a panel that works everywhere
     and one that needs setting up first. */
  const pasted = workshopIdFrom(text);
  if (pasted) {
    try {
      const items = await workshopDetails([pasted]);
      if (items.length === 0) {
        return { ok: false, title: "Steam does not know that item", body: `Nothing on the Workshop has the id ${pasted}.` };
      }
      return { ok: true, tone: "success", title: "Found it", body: items[0]!.title, items, more: false, chosen };
    } catch (error) {
      const failure = asPlatformError(error);
      return { ok: false, title: "Could not ask Steam", body: failure.message };
    }
  }

  try {
    const found = await searchWorkshop(reached.support.appId, text, { page });
    return {
      ok: true,
      tone: "success",
      title: `${found.items.length} from the Workshop`,
      body: text.trim() ? `Matching “${text.trim()}”.` : "Most subscribed.",
      items: found.items,
      more: found.more,
      chosen,
    };
  } catch (error) {
    const failure = asPlatformError(error);
    return {
      ok: false,
      title: failure.code === "MOD_SEARCH_UNAVAILABLE" ? "Browsing needs a Steam key" : "Could not ask Steam",
      body: failure.message,
    };
  }
}

export async function addModOp(user: User, slug: string, idOrUrl: string): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, support } = reached;

  const workshopId = workshopIdFrom(idOrUrl);
  if (!workshopId) {
    return {
      ok: false,
      title: "That is not a Workshop item",
      body: "Paste the item's link from steamcommunity.com, or its id — the number after ?id=.",
    };
  }

  const already = await db.serverMod.findUnique({
    where: { serverId_workshopId: { serverId: server.id, workshopId } },
  });
  if (already) {
    return { ok: false, title: "Already on this server", body: `${already.title} is in the list.` };
  }

  let item: WorkshopItem | undefined;
  try {
    [item] = await workshopDetails([workshopId]);
  } catch (error) {
    return { ok: false, title: "Could not ask Steam", body: asPlatformError(error).message };
  }
  if (!item) {
    return {
      ok: false,
      title: "Steam does not know that item",
      body: `Nothing on the Workshop has the id ${workshopId}. A deleted or hidden item reads the same way.`,
    };
  }

  const last = await db.serverMod.aggregate({ where: { serverId: server.id }, _max: { position: true } });

  await db.serverMod.create({
    data: {
      serverId: server.id,
      workshopId,
      title: item.title,
      previewUrl: item.previewUrl,
      sizeBytes: Math.min(item.sizeBytes, 2_000_000_000),
      position: (last._max.position ?? 0) + 1,
      addedById: user.id,
    },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.mod.added",
      target: server.name,
      tone: "INFO",
      serverId: server.id,
      changes: { Mod: { from: "—", to: `${item.title} (${workshopId})` } },
    },
  });

  return {
    ok: true,
    tone: "success",
    title: `${item.title} added`,
    body:
      support.provider === "steam-workshop"
        ? "Chosen, not installed: apply the list and the server downloads it on its next start."
        : "Chosen.",
  };
}

export async function removeModOp(user: User, slug: string, workshopId: string): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server } = reached;

  const mod = await db.serverMod.findUnique({
    where: { serverId_workshopId: { serverId: server.id, workshopId } },
  });
  if (!mod) return { ok: false, title: "Not on this server", body: "That mod is not in the list." };

  await db.serverMod.delete({ where: { id: mod.id } });
  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.mod.removed",
      target: server.name,
      tone: "WARNING",
      serverId: server.id,
      changes: { Mod: { from: `${mod.title} (${workshopId})`, to: "—" } },
    },
  });

  return {
    ok: true,
    tone: "warning",
    title: `${mod.title} removed from the list`,
    body: "Apply the list to take it off the server itself. What it added to the world stays in the world.",
  };
}

export async function setModEnabledOp(
  user: User,
  slug: string,
  workshopId: string,
  enabled: boolean,
): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;

  const mod = await db.serverMod.findUnique({
    where: { serverId_workshopId: { serverId: reached.server.id, workshopId } },
  });
  if (!mod) return { ok: false, title: "Not on this server", body: "That mod is not in the list." };

  await db.serverMod.update({ where: { id: mod.id }, data: { enabled } });
  return {
    ok: true,
    tone: "success",
    title: enabled ? `${mod.title} will load` : `${mod.title} will not load`,
    body: enabled
      ? "Apply the list to load it."
      : "It stays downloaded, so turning it back on costs nothing. Apply the list to stop loading it.",
  };
}

/** The order the game loads them in, which is who wins a conflict. */
export async function reorderModsOp(user: User, slug: string, workshopIds: string[]): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;

  const mods = await db.serverMod.findMany({ where: { serverId: reached.server.id } });
  const known = new Set(mods.map((mod) => mod.workshopId));
  if (workshopIds.length !== mods.length || workshopIds.some((id) => !known.has(id))) {
    return { ok: false, title: "That order does not match", body: "The list changed while you were moving things. Reload." };
  }

  await db.$transaction(
    workshopIds.map((workshopId, index) =>
      db.serverMod.update({
        where: { serverId_workshopId: { serverId: reached.server.id, workshopId } },
        data: { position: index + 1 },
      }),
    ),
  );

  return { ok: true, tone: "success", title: "Order saved", body: "Apply the list to load them in this order." };
}

/* ── Applying ─────────────────────────────────────────────────────
   Writing the two keys into the game's settings, and restarting it so
   it reads them. A backup first, because a mod is the one change that
   can break a world rather than a workload. */

function planStub(server: Server) {
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

export async function applyModsOp(user: User, slug: string, options: { backup?: boolean } = {}): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, game } = reached;

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    return {
      ok: false,
      title: "No agent on this node",
      body: `${server.node.name} has no agent attached, so nothing can be written to the server.`,
    };
  }

  const mods = (
    await db.serverMod.findMany({
      where: { serverId: server.id },
      orderBy: { position: "asc" },
      include: { addedBy: { select: { name: true } } },
    })
  ).map(rowOf);
  const should = wanted(mods);

  /* The world first. A mod can change what a save contains, and the way
     back from a mod that ruins one is a backup taken before it loaded —
     not an apology afterwards. Skipped only when asked, and said so. */
  if (options.backup !== false && isUp(server.state)) {
    const backup = await createBackupOp(user, slug, { trigger: "PRE_UPDATE", prefix: "pre-mods" });
    if (!backup.ok) {
      return {
        ok: false,
        title: "Backed out: the backup failed",
        body: `${backup.body} Nothing was written, so the server is as it was.`,
      };
    }
  }

  const version = versionOfServer(game, {
    versionSlug: null,
    versionLabel: server.version,
  });
  const scoped = version ? scopeToLine(game, version.line) : game;
  const rendered = renderConfig(scoped, currentConfig(scoped, server), version, {
    includeEmpty: true,
    mods: should,
  });

  try {
    await writeConfigFiles(
      { game: scoped, runtime, plan: planStub(server), files: rendered.files, report: () => {} },
      { serverId: server.id, runtimeId: server.runtimeId },
    );
  } catch (error) {
    const failure = asPlatformError(error);
    return {
      ok: false,
      title: "Could not write the mod list",
      body: `${failure.message}. The list here is unchanged; the server was not touched.`,
    };
  }

  await db.server.update({
    where: { id: server.id },
    data: { modItemsApplied: should.items, modIdsApplied: should.enabled },
  });

  await db.activityEvent.create({
    data: {
      actor: user.name,
      action: "server.mods.applied",
      target: server.name,
      tone: "INFO",
      serverId: server.id,
      changes: {
        Downloads: { from: `${server.modItemsApplied.length}`, to: `${should.items.length}` },
        Loaded: { from: `${server.modIdsApplied.length}`, to: `${should.enabled.length}` },
      },
    },
  });

  const waiting = mods.filter((mod) => mod.modIds.length === 0).length;
  return {
    ok: true,
    tone: "warning",
    title: "Mod list written",
    body: isUp(server.state)
      ? `Restart ${server.name} for the game to read it.${waiting > 0 ? ` ${waiting} still to download — that happens on the next start, and can take minutes.` : ""}`
      : `${server.name} will read it the next time it starts.`,
  };
}

/* ── What the node found ──────────────────────────────────────────
   The only answer to "what is actually inside these downloads". */

export async function refreshInstalledOp(user: User, slug: string): Promise<OpResult & { found?: number }> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, support } = reached;

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    return { ok: false, title: "No agent on this node", body: `${server.node.name} has no agent attached.` };
  }

  let items: Array<{ workshopId: string; mods: Array<{ id: string; name: string }> }>;
  try {
    items = await runtime.mods(
      { serverId: server.id, runtimeId: server.runtimeId },
      support.contentPath.startsWith("/") ? modMountOf(support) : "",
      support.contentPath,
    );
  } catch (error) {
    const failure = asPlatformError(error);
    return {
      ok: false,
      title: "Could not ask the node",
      body:
        failure.code === "RUNTIME_REJECTED" && /mods/.test(failure.message)
          ? `${server.node.name} is running an agent from before mods existed. Upgrade it.`
          : failure.message,
    };
  }

  const byId = new Map(items.map((item) => [item.workshopId, item.mods.map((mod) => mod.id)]));
  const mods = await db.serverMod.findMany({ where: { serverId: server.id } });

  let found = 0;
  for (const mod of mods) {
    const modIds = byId.get(mod.workshopId) ?? [];
    if (sameList(modIds, mod.modIds)) continue;
    await db.serverMod.update({ where: { id: mod.id }, data: { modIds } });
    if (modIds.length > 0) found++;
  }

  const still = mods.filter((mod) => (byId.get(mod.workshopId) ?? []).length === 0).length;
  return {
    ok: true,
    tone: still > 0 ? "warning" : "success",
    title: still > 0 ? `${still} not downloaded yet` : "Everything is downloaded",
    body:
      still > 0
        ? "The game fetches them while it starts. Ask again in a minute."
        : `${server.node.name} has the files for every mod in the list.`,
    found,
  };
}

/** The cache mount a game's content path sits in, from its definition. */
function modMountOf(support: ModSupport): string {
  /* The definition names the content directory, which is inside the
     cache mount the workload was given. The mount is the part before
     `/content`, which is Steam's own layout and not ours to choose. */
  const at = support.contentPath.indexOf("/content");
  return at > 0 ? support.contentPath.slice(0, at) : support.contentPath;
}
