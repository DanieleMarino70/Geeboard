import "server-only";
import { Prisma, type Server, type User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import { expandCollection } from "@/domain/games/collections";
import { currentConfig, renderConfig, scopeToLine } from "@/domain/games/config";
import { writeConfigFiles } from "@/domain/games/install";
import {
  buildSummary,
  gameVersionOf,
  judgeServer,
  layoutFor,
  otherBuildOnly,
  refusalText,
  requiredIds,
  type ModFacts,
  type VersionNumbers,
} from "@/domain/games/mod-builds";
import { requireGame, versionOfServer } from "@/domain/games/registry";
import type { GameDefinition, ModSupport } from "@/domain/games/types";
import { checkAgentVersion } from "@/domain/nodes/agent-version";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeModItem } from "@/domain/runtime/types";
import { readyThisRun } from "@/domain/servers/health";
import { isUp } from "@/domain/servers/state";
import { createBackupOp } from "./backup-ops";
import { db } from "./db";
import type { OpResult } from "./server-ops";
import { noteKeyAnswer, workshopKey } from "./steam-ops";
import { PANEL_VERSION } from "./version";
import { searchWorkshop, workshopCollections, workshopDetails, workshopIdFrom, type WorkshopItem } from "./workshop";

/* Mods on a server.

   The shape of this follows what the game actually does, which for
   Project Zomboid is: read two keys out of its own settings file on
   every start, download whatever Workshop ids the first one lists, and
   load whatever mod ids the second one lists. Nothing else is involved —
   no package manager, no registry of ours, and no byte of a mod passing
   through the panel.

   So the panel's job is to keep a list, write those two keys, and be
   honest about the states a mod can be in:

     chosen      a row here; the game has not been told yet
     downloaded  the node has the files, and told us what is inside them
     loaded      its mod ids are in the game's load list

   The gap between the first two is a restart, and the gap between the
   second and third is why the mod ids are read off the node rather than
   guessed from a Workshop description: one Workshop item can carry
   several mods, and the name the game loads them by lives in a
   `mod.info` inside the download.

   And a download is not always a mod this server can load. Build 42
   reads a mod's files from a folder per game version, Build 41 from the
   top, and a mod.info can bound the versions it runs on — so what the
   node found is judged against the server's own build before anything
   reaches the load list (domain/games/mod-builds.ts). A mod the game
   cannot see is not an error to the game: measured on both builds, it
   logs "not found" and starts without it. Nothing would say so, which
   is why this does. */

export interface ModRow {
  id: string;
  workshopId: string;
  title: string;
  previewUrl: string | null;
  sizeBytes: number;
  /** Every mod id the node found inside the download. Empty until it has one. */
  modIds: string[];
  /** Of those, the ones this server's build will load. What goes in the load list. */
  loads: string[];
  /** The ones it will not, and why, in a sentence. */
  refused: Array<{ id: string; reason: string }>;
  /** Switched off, and loaded anyway: the mods switched on that require it. */
  pulledInBy: string[];
  /** The node has the download — which may still hold nothing the game loads. */
  downloaded: boolean;
  enabled: boolean;
  position: number;
  addedBy: string | null;
  addedAt: Date;
}

export interface ModsView {
  /** Null when this game takes no mods, which the panel says rather than hiding. */
  support: ModSupport | null;
  game: string;
  /** The build the server runs, as the panel names it: "Build 42", "42.20.4". Null when unknown. */
  build: { label: string; version: string } | null;
  /** Whether this installation can browse the Workshop, or only take links. */
  searchAvailable: boolean;
  mods: ModRow[];
  /** The chosen list differs from what the game was last told. */
  pending: boolean;
  /** Mods whose downloads the node has not reported yet. */
  awaitingDownload: number;
  /** Mods downloaded that this build will not load. */
  refused: number;
  serverState: string;
  /** False when the node has no agent: nothing can be written or read. */
  attached: boolean;
}

type ServerWithNode = Server & {
  node: { name: string; daemonUrl: string | null; daemonToken: string | null; daemon: string };
  gameVersionRef: { slug: string } | null;
};

async function load(slug: string): Promise<ServerWithNode | null> {
  return db.server.findUnique({
    where: { slug },
    include: {
      node: { select: { name: true, daemonUrl: true, daemonToken: true, daemon: true } },
      gameVersionRef: { select: { slug: true } },
    },
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

/** The build a server runs, when its definition says which game version that is. */
interface Build {
  label: string;
  version: string;
  numbers: VersionNumbers;
}

function buildOf(game: GameDefinition, server: ServerWithNode): Build | null {
  const version = versionOfServer(game, { versionSlug: server.gameVersionRef?.slug, versionLabel: server.version });
  const numbers = gameVersionOf(version?.upstream);
  return version?.upstream && numbers ? { label: version.label, version: version.upstream, numbers } : null;
}

type StoredMod = {
  id: string;
  workshopId: string;
  title: string;
  previewUrl: string | null;
  sizeBytes: number;
  modIds: string[];
  contents: Prisma.JsonValue | null;
  enabled: boolean;
  position: number;
  addedAt: Date;
  addedBy: { name: string } | null;
};

/* What the node reported, as the judge reads it. A row filled in by an
   agent from before 0.3.0 has ids and nothing else, read from the top of
   each mod's directory — which is exactly the one layout that agent could
   see, so it is judged as that rather than trusted blindly. */
function factsOf(mod: Pick<StoredMod, "contents" | "modIds">): ModFacts[] | null {
  if (Array.isArray(mod.contents)) return mod.contents as unknown as ModFacts[];
  if (mod.modIds.length === 0) return null;
  return mod.modIds.map((id) => ({
    dir: id,
    folders: [],
    infos: [{ folder: "", id, name: id, versionMin: null, versionMax: null }],
  }));
}

/* Every row, judged together: whether a mod loads depends on the others,
   because one whose requirement is missing is not loaded — see
   judgeServer in domain/games/mod-builds.ts. */
function rowsFrom(stored: StoredMod[], support: ModSupport | null, build: Build | null): ModRow[] {
  const facts = stored.map(factsOf);
  const flat = facts.flatMap((found, row) => (found ?? []).map((mod) => ({ row, mod })));
  const verdicts = build ? judgeServer(flat.map((f) => f.mod), support?.layout, build.numbers) : null;

  const loads = stored.map(() => [] as string[]);
  const refused = stored.map(() => [] as ModRow["refused"]);
  flat.forEach(({ row, mod }, i) => {
    const verdict = verdicts?.[i];
    if (!verdict || !build) {
      // No version to judge against: what the node found is what is loaded, as before.
      loads[row]!.push(...mod.infos.slice(0, 1).map((info) => info.id));
    } else if (verdict.loads) {
      loads[row]!.push(verdict.id);
    } else {
      refused[row]!.push({ id: verdict.id, reason: refusalText(verdict.refusal, build.label, build.version) });
    }
  });

  /* A mod switched off is still loaded when one switched on requires it:
     the game loads what is required whether it was listed or not. Said
     on its row, rather than letting "off" stand. */
  const requiredByEnabled = new Map<string, string[]>();
  flat.forEach(({ row, mod }, i) => {
    const verdict = verdicts?.[i];
    if (!verdict?.loads || !stored[row]!.enabled) return;
    const info = mod.infos.find((candidate) => candidate.folder === verdict.folder);
    for (const id of info && build ? requiredIds(info, layoutFor(support?.layout, build.numbers)) : []) {
      requiredByEnabled.set(id, [...(requiredByEnabled.get(id) ?? []), verdict.id]);
    }
  });

  return stored.map((mod, row) => ({
    id: mod.id,
    workshopId: mod.workshopId,
    title: mod.title,
    previewUrl: mod.previewUrl,
    sizeBytes: mod.sizeBytes,
    modIds: mod.modIds,
    loads: [...new Set(loads[row])],
    refused: refused[row]!,
    pulledInBy: mod.enabled ? [] : [...new Set(loads[row]!.flatMap((id) => requiredByEnabled.get(id) ?? []))],
    downloaded: facts[row] !== null,
    enabled: mod.enabled,
    position: mod.position,
    addedBy: mod.addedBy?.name ?? null,
    addedAt: mod.addedAt,
  }));
}

async function rowsOf(server: ServerWithNode, support: ModSupport | null, game: GameDefinition | null): Promise<ModRow[]> {
  const build = game ? buildOf(game, server) : null;
  const stored = await db.serverMod.findMany({
    where: { serverId: server.id },
    orderBy: { position: "asc" },
    include: { addedBy: { select: { name: true } } },
  });
  return rowsFrom(stored, support, build);
}

/** What the game should be told, from what the operator has chosen. */
function wanted(mods: ModRow[]): { items: string[]; enabled: string[] } {
  const ordered = [...mods].sort((a, b) => a.position - b.position);
  return {
    /* Every item is downloaded, including the ones switched off: a mod
       turned off and on again should not be a five-minute download. */
    items: ordered.map((mod) => mod.workshopId),
    /* Only what this build loads. A mod it cannot see would be logged
       "not found" and skipped — harmless to the game, and a lie on this
       page, which would call it loaded. */
    enabled: ordered.filter((mod) => mod.enabled).flatMap((mod) => mod.loads),
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export async function modsView(user: User, slug: string): Promise<ModsView | null> {
  const server = await load(slug);
  if (!server || !can(user, "server.read", server.ownerId)) return null;

  const found = supportOf(server);
  const build = found ? buildOf(found.game, server) : null;
  const mods = await rowsOf(server, found?.support ?? null, found?.game ?? null);
  const should = wanted(mods);

  return {
    support: found?.support ?? null,
    game: server.game,
    build: build ? { label: build.label, version: build.version } : null,
    searchAvailable: (await workshopKey()) !== null,
    mods,
    pending:
      !sameList(should.items, server.modItemsApplied) || !sameList(should.enabled, server.modIdsApplied),
    awaitingDownload: mods.filter((mod) => !mod.downloaded).length,
    refused: mods.reduce((sum, mod) => sum + mod.refused.length, 0),
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
): Promise<
  | { ok: true; server: ServerWithNode; support: ModSupport; game: GameDefinition; build: Build | null }
  | { ok: false; result: OpResult }
> {
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

  return { ok: true, server, support: found.support, game: found.game, build: buildOf(found.game, server) };
}

/* ── Which build an item is for, before it is downloaded ──────────
   The Workshop's tags are the only word on it until the node has the
   files, and they are the author's: right usually, wrong sometimes. So
   they are said beside the item and never used to refuse it — what the
   node finds after the download is what decides the load list. */

/** Items tagged only for another build than this server's, and the tags they carry instead. */
function offBuildOf(items: WorkshopItem[], support: ModSupport, build: Build | null): Record<string, string> {
  if (!build || !support.buildTags) return {};
  const off: Record<string, string> = {};
  for (const item of items) {
    const other = otherBuildOnly(item.tags, support.buildTags, build.numbers);
    if (other) off[item.id] = `${other.join(" and ")} only`;
  }
  return off;
}

/* ── Collections ──────────────────────────────────────────────────
   A collection is a list of other items, and the game cannot download
   one: it is told item ids. So a collection is expanded here, into the
   items it holds — the rules for that, cycles and all, are in
   domain/games/collections.ts — and those are what get added. Nothing
   about a collection reaches the node, which sees item ids exactly as
   it did before. No key: both questions it asks Steam are keyless. */

export interface CollectionPreview {
  id: string;
  title: string;
  previewUrl: string | null;
  /** The game Steam says it is for. Zero when unknown. */
  appId: number;
  /** Every item it holds that this game can take, in the order they would be added. */
  items: WorkshopItem[];
  /** Of `items`, how many this server already has. They keep their place. */
  already: number;
  /** Items Steam no longer has: deleted or hidden. */
  gone: number;
  /** Items for another game, which a collection can hold and this game cannot load. */
  otherGame: number;
  /** Collections it links, which were followed. */
  linked: Array<{ id: string; title: string }>;
  /** Of `items`, how many only a linked collection held. */
  fromLinked: number;
  /** Linked collections that are gone. */
  missingLinks: number;
  /** The collection is larger than the panel will add in one go. */
  truncated: boolean;
  /** "5 for Build 42, 1 for Build 41 only", from the items' tags. Null when none names a build. */
  builds: string | null;
  /** Items tagged only for another build, by id: "Build 41 only". */
  offBuild: Record<string, string>;
}

async function resolveCollection(
  support: ModSupport,
  build: Build | null,
  root: string,
  have: ReadonlySet<string>,
): Promise<CollectionPreview | null> {
  const expanded = await expandCollection(root, workshopCollections);
  if (!expanded) return null;

  // Its own title and its links' come back with the items, in the same few requests.
  const details = await workshopDetails([root, ...expanded.linked, ...expanded.items]);
  const byId = new Map(details.map((item) => [item.id, item]));
  const found = expanded.items.map((id) => byId.get(id)).filter((item): item is WorkshopItem => item !== undefined);
  const items = found.filter((item) => !item.appId || item.appId === support.appId);
  const viaLinks = new Set(expanded.fromLinked);
  const self = byId.get(root);

  return {
    id: root,
    title: self?.title ?? `Collection ${root}`,
    previewUrl: self?.previewUrl ?? null,
    appId: self?.appId ?? 0,
    items,
    already: items.filter((item) => have.has(item.id)).length,
    gone: expanded.items.length - found.length,
    otherGame: found.length - items.length,
    linked: expanded.linked.map((id) => ({ id, title: byId.get(id)?.title ?? `Collection ${id}` })),
    fromLinked: items.filter((item) => viaLinks.has(item.id)).length,
    missingLinks: expanded.missing.length,
    truncated: expanded.truncated,
    builds: build && support.buildTags ? buildSummary(items, support.buildTags, build.numbers) : null,
    offBuild: offBuildOf(items, support, build),
  };
}

function forAnotherGame(what: CollectionPreview | WorkshopItem, appId: number): boolean {
  return what.appId !== 0 && what.appId !== appId;
}

export type SearchResult = OpResult & {
  items?: WorkshopItem[];
  more?: boolean;
  /** Which of these are already on this server. */
  chosen?: string[];
  /** Set instead of `items` when what was pasted is a collection. */
  collection?: CollectionPreview;
  /** Of `items`, the ones tagged only for another build than this server's. */
  offBuild?: Record<string, string>;
};

export async function searchModsOp(
  user: User,
  slug: string,
  text: string,
  page = 1,
): Promise<SearchResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { support, game, build } = reached;

  const chosen = (await db.serverMod.findMany({ where: { serverId: reached.server.id }, select: { workshopId: true } }))
    .map((mod) => mod.workshopId);

  /* A pasted link is not a search: an operator who has an id in hand
     gets that item back whether or not this installation has a Steam
     key, which is the difference between a panel that works everywhere
     and one that needs setting up first. A collection's link is the
     same, and answers with what is in it. */
  const pasted = workshopIdFrom(text);
  if (pasted) {
    try {
      const collection = await resolveCollection(support, build, pasted, new Set(chosen));
      if (collection) {
        if (forAnotherGame(collection, support.appId)) {
          return {
            ok: false,
            title: "That collection is for another game",
            body: `${collection.title} is on the Workshop for another game, and ${game.name} cannot load it.`,
          };
        }
        return {
          ok: true,
          tone: "success",
          title: collection.title,
          body: `A collection of ${collection.items.length}.`,
          items: [],
          more: false,
          chosen,
          collection,
        };
      }

      const items = await workshopDetails([pasted]);
      if (items.length === 0) {
        return { ok: false, title: "Steam does not know that item", body: `Nothing on the Workshop has the id ${pasted}.` };
      }
      if (forAnotherGame(items[0]!, support.appId)) {
        return {
          ok: false,
          title: "That item is for another game",
          body: `${items[0]!.title} is on the Workshop for another game, and ${game.name} cannot load it.`,
        };
      }
      return {
        ok: true,
        tone: "success",
        title: "Found it",
        body: items[0]!.title,
        items,
        more: false,
        chosen,
        offBuild: offBuildOf(items, support, build),
      };
    } catch (error) {
      const failure = asPlatformError(error);
      return { ok: false, title: "Could not ask Steam", body: failure.message };
    }
  }

  const key = await workshopKey();
  if (!key) {
    return {
      ok: false,
      title: "Browsing needs a Steam key",
      body: "Searching the Workshop needs a Steam Web API key, which an owner or admin can set on this tab. A link to an item or a collection works without one.",
    };
  }

  try {
    const found = await searchWorkshop(key.key, support.appId, text, { page });
    await noteKeyAnswer(key.source, null);
    return {
      ok: true,
      tone: "success",
      title: `${found.items.length} from the Workshop`,
      body: text.trim() ? `Matching “${text.trim()}”.` : "Most subscribed.",
      items: found.items,
      more: found.more,
      chosen,
      offBuild: offBuildOf(found.items, support, build),
    };
  } catch (error) {
    const failure = asPlatformError(error);
    if (failure.code !== "MOD_KEY_REFUSED") return { ok: false, title: "Could not ask Steam", body: failure.message };

    await noteKeyAnswer(key.source, failure.message);
    return {
      ok: false,
      title: "Steam refused the key",
      body:
        key.source === "environment"
          ? "Revoked or mistyped, most likely. It is STEAM_API_KEY, in the panel's environment. A link still works."
          : "Revoked or mistyped, most likely. An owner or admin can replace it on this tab. A link still works.",
    };
  }
}

export async function addModOp(user: User, slug: string, idOrUrl: string): Promise<OpResult> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, support, game, build } = reached;

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

  /* Whether it is a collection is asked alongside its details, because
     the details alone cannot tell: Steam describes a collection as an
     item of size nothing. Written into the game as one, it is an id the
     game cannot download. */
  let item: WorkshopItem | undefined;
  let collection = false;
  try {
    const [collections, details] = await Promise.all([workshopCollections([workshopId]), workshopDetails([workshopId])]);
    collection = collections.has(workshopId);
    item = details[0];
  } catch (error) {
    return { ok: false, title: "Could not ask Steam", body: asPlatformError(error).message };
  }
  if (collection) {
    return {
      ok: false,
      title: "That is a collection",
      body: "A collection is a list of other items, and the game cannot download it as one. Paste its link into the Workshop box to see what is in it, and add those.",
    };
  }
  if (!item) {
    return {
      ok: false,
      title: "Steam does not know that item",
      body: `Nothing on the Workshop has the id ${workshopId}. A deleted or hidden item reads the same way.`,
    };
  }
  if (forAnotherGame(item, support.appId)) {
    return {
      ok: false,
      title: "That item is for another game",
      body: `${item.title} is on the Workshop for another game, and ${game.name} cannot load it.`,
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

  const off = offBuildOf([item], support, build)[item.id];
  if (off && build) {
    return {
      ok: true,
      tone: "warning",
      title: `${item.title} added — tagged ${off}`,
      body: `This server is ${build.label}. Tags are the author's and sometimes wrong, so it is added anyway; once the game has downloaded it, Ask the node says whether ${build.label} loads it, and it stays out of the load list if not.`,
    };
  }

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

/* Every item in a collection, added at once.

   Additive and nothing else. The new items go after everything already
   on the server, in the collection's own order; an item the server
   already has keeps its place, its on-or-off and its mod ids. Adding a
   collection never reorders or switches back on something an operator
   arranged. Items tagged for another build are added too, and said:
   the tag is a warning, the node's answer is the verdict. */
export async function addCollectionOp(user: User, slug: string, idOrUrl: string): Promise<OpResult & { added?: number }> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, support, game, build } = reached;

  const collectionId = workshopIdFrom(idOrUrl);
  if (!collectionId) {
    return {
      ok: false,
      title: "That is not a Workshop collection",
      body: "Paste the collection's link from steamcommunity.com, or its id — the number after ?id=.",
    };
  }

  const have = new Set(
    (await db.serverMod.findMany({ where: { serverId: server.id }, select: { workshopId: true } })).map((mod) => mod.workshopId),
  );

  /* Asked of Steam again rather than taken from the preview the browser
     was shown: what gets written is not the browser's to say, and a
     collection can change in between. */
  let collection: CollectionPreview | null;
  try {
    collection = await resolveCollection(support, build, collectionId, have);
  } catch (error) {
    return { ok: false, title: "Could not ask Steam", body: asPlatformError(error).message };
  }
  if (!collection) {
    return {
      ok: false,
      title: "That is not a collection",
      body: `Steam has no collection with the id ${collectionId}. A single item is added with its own Add.`,
    };
  }
  if (forAnotherGame(collection, support.appId)) {
    return {
      ok: false,
      title: "That collection is for another game",
      body: `${collection.title} is on the Workshop for another game, and ${game.name} cannot load it.`,
    };
  }

  const fresh = collection.items.filter((item) => !have.has(item.id));
  if (fresh.length === 0) {
    return {
      ok: false,
      title: "Nothing new",
      body: `Everything in ${collection.title} that ${game.name} can load is already on this server.`,
    };
  }

  const last = await db.serverMod.aggregate({ where: { serverId: server.id }, _max: { position: true } });
  const first = (last._max.position ?? 0) + 1;

  const [created] = await db.$transaction([
    db.serverMod.createMany({
      data: fresh.map((item, index) => ({
        serverId: server.id,
        workshopId: item.id,
        title: item.title,
        previewUrl: item.previewUrl,
        sizeBytes: Math.min(item.sizeBytes, 2_000_000_000),
        position: first + index,
        addedById: user.id,
      })),
      // Somebody adding one of them by hand in the same second is not a failure.
      skipDuplicates: true,
    }),
    db.activityEvent.create({
      data: {
        actor: user.name,
        action: "server.mods.collection.added",
        target: server.name,
        tone: "INFO",
        serverId: server.id,
        changes: {
          Collection: { from: "—", to: `${collection.title} (${collectionId})` },
          Mods: { from: `${have.size}`, to: `${have.size + fresh.length}` },
        },
      },
    }),
  ]);

  const offBuild = fresh.filter((item) => collection.offBuild[item.id]).length;
  const left = [
    collection.already > 0 ? `${collection.already} already here kept their place.` : "",
    collection.gone > 0 ? `${collection.gone} no longer on Steam were left out.` : "",
    collection.otherGame > 0 ? `${collection.otherGame} for another game were left out.` : "",
    collection.truncated ? "It was larger than the panel adds at once; the rest were not added." : "",
    offBuild > 0 && build
      ? `${offBuild} ${offBuild === 1 ? "is" : "are"} tagged for another build than ${build.label}: added anyway, and kept out of the load list if the node finds ${build.label} cannot load ${offBuild === 1 ? "it" : "them"}.`
      : "",
  ].filter(Boolean);

  return {
    ok: true,
    tone: offBuild > 0 ? "warning" : "success",
    title: `${created.count} mod${created.count === 1 ? "" : "s"} added from ${collection.title}`,
    body: ["Chosen, not installed: apply the list and the server downloads them on its next start.", ...left].join(" "),
    added: created.count,
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
  const { server, game, support, build } = reached;

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    return {
      ok: false,
      title: "No agent on this node",
      body: `${server.node.name} has no agent attached, so nothing can be written to the server.`,
    };
  }

  const starting = await stillStarting(runtime, { serverId: server.id, runtimeId: server.runtimeId }, game, server);
  if (starting) {
    return {
      ok: false,
      title: `${server.name} is still starting`,
      body: `${game.name} rewrites its own settings file on the way up, after it has fetched its downloads, so a list written now would be lost. Apply once the console says it has started.`,
    };
  }

  const mods = await rowsOf(server, support, game);
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
    versionSlug: server.gameVersionRef?.slug,
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

  const waiting = mods.filter((mod) => !mod.downloaded).length;
  const kept = mods.filter((mod) => mod.enabled).reduce((sum, mod) => sum + mod.refused.length, 0);
  const notes = [
    waiting > 0 ? `${waiting} still to download — that happens on the next start, and can take minutes.` : "",
    kept > 0 && build
      ? `${kept} left out of the load list: ${build.label} will not load ${kept === 1 ? "it" : "them"}, as the list says.`
      : "",
  ].filter(Boolean);

  return {
    ok: true,
    tone: "warning",
    title: "Mod list written",
    body: [
      isUp(server.state) ? `Restart ${server.name} for the game to read it.` : `${server.name} will read it the next time it starts.`,
      ...notes,
    ].join(" "),
  };
}

/* Whether the game is up and has not yet said it is ready, this start.

   Measured on 41.78.19: a start that downloads Workshop items writes the
   game's settings file again once they are in — from what it read when
   it started, so a `Mods` line written in between is gone by the time
   it says SERVER STARTED. And that in-between is exactly when the node
   first has the files, so the natural order — restart, Ask the node,
   Apply — lands in it. So nothing is written until the game has said it
   is ready: known from the poller's readiness when it has seen it, and
   otherwise asked of the node's console since the workload started.

   Past the game's boot grace it is not held up any longer: a server that
   has not said it is ready by then is the health check's to call, and
   the ready line may simply have scrolled out of the lines the node
   keeps. A game that declares no ready line, or a node that cannot be
   asked, is not held up either — this guards against one race, and
   refusing on a guess would be a new way to be stuck. */
async function stillStarting(
  runtime: NonNullable<ReturnType<typeof runtimeFor>>,
  ref: { serverId: string; runtimeId: string },
  game: GameDefinition,
  server: Pick<Server, "readyAt" | "startedAt">,
): Promise<boolean> {
  const pattern = game.health.readyPattern;
  if (!pattern) return false;
  if (readyThisRun(server.readyAt, server.startedAt)) return false;

  try {
    const status = await runtime.status(ref);
    if (status.state !== "running" || !status.startedAt) return false;
    const startedAt = new Date(status.startedAt);
    if (Date.now() - startedAt.getTime() > game.health.bootGraceSeconds * 1000) return false;
    const expression = new RegExp(pattern);
    const lines = await runtime.logs(ref, 2000, startedAt);
    return !lines.some((line) => expression.test(line.line));
  } catch {
    return false;
  }
}

/* ── What the node found ──────────────────────────────────────────
   The only answer to "what is actually inside these downloads". */

/** Author-written text, kept to a size a row can hold. */
function clip(text: string, length = 200): string {
  return text.length > length ? text.slice(0, length) : text;
}

function storable(item: RuntimeModItem): ModFacts[] {
  return item.mods.slice(0, 64).map((mod) => ({
    dir: clip(mod.dir),
    folders: mod.folders.slice(0, 64).map((folder) => clip(folder)),
    infos: mod.infos.slice(0, 65).map((info) => ({
      folder: clip(info.folder),
      id: clip(info.id),
      name: clip(info.name),
      versionMin: info.versionMin === null ? null : clip(info.versionMin, 40),
      versionMax: info.versionMax === null ? null : clip(info.versionMax, 40),
      require: info.require.slice(0, 64).map((id) => clip(id)),
    })),
  }));
}

export async function refreshInstalledOp(user: User, slug: string): Promise<OpResult & { found?: number }> {
  const reached = await reach(user, slug);
  if (!reached.ok) return reached.result;
  const { server, support, game, build } = reached;

  const runtime = runtimeFor(server.node);
  if (!runtime || !server.runtimeId) {
    return { ok: false, title: "No agent on this node", body: `${server.node.name} has no agent attached.` };
  }

  /* An agent on another release line reads a download differently: one
     before 0.3.0 looks only where Build 41 keeps a mod, so its answer
     would call every Build 42 mod missing. Asked anyway, it would be
     believed — so it is not asked. */
  const behind = `${server.node.name} runs agent ${server.node.daemon}, and the panel is ${PANEL_VERSION}: they read a download differently. Upgrade the agent, then ask again.`;
  if (checkAgentVersion(PANEL_VERSION, server.node.daemon).verdict === "incompatible") {
    return { ok: false, title: "Upgrade the agent first", body: behind };
  }

  let items: RuntimeModItem[];
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

  // A version nobody reported is let through above; the shape of the answer is the second check.
  if (items.some((item) => item.mods.some((mod) => !Array.isArray((mod as Partial<typeof mod>).infos)))) {
    return { ok: false, title: "Upgrade the agent first", body: behind };
  }

  /* A download with no mod.info in it yet is a download still going.
     Measured on 41.78.19: Steam writes an item into its folder as it
     arrives — `mods/tsarslib/` there, its mod.info not, for minutes — and
     lists it as installed only in its own manifest once it is whole. So
     an item with nothing readable is waiting, not empty. */
  const byId = new Map(items.filter((item) => item.mods.length > 0).map((item) => [item.workshopId, storable(item)]));
  const mods = await db.serverMod.findMany({ where: { serverId: server.id } });

  let found = 0;
  for (const mod of mods) {
    const contents = byId.get(mod.workshopId) ?? null;
    const modIds = [...new Set((contents ?? []).flatMap((m) => m.infos.map((info) => info.id)))];
    if (sameList(modIds, mod.modIds) && JSON.stringify(contents) === JSON.stringify(mod.contents)) continue;
    await db.serverMod.update({
      where: { id: mod.id },
      data: { modIds, contents: contents === null ? Prisma.DbNull : (contents as unknown as Prisma.InputJsonValue) },
    });
    if (contents !== null) found++;
  }

  const rows = await rowsOf(server, support, game);
  const still = rows.filter((row) => !row.downloaded).length;
  const refused = rows.reduce((sum, row) => sum + row.refused.length, 0);
  const ready = rows.reduce((sum, row) => sum + row.loads.length, 0);

  const notes = [
    still > 0 ? `${still} not downloaded yet: the game fetches them while it starts. Ask again in a minute.` : "",
    refused > 0 && build
      ? `${refused} downloaded that ${build.label} will not load — the list says why, and they stay out of the load list.`
      : "",
  ].filter(Boolean);

  return {
    ok: true,
    tone: notes.length > 0 ? "warning" : "success",
    title:
      still > 0
        ? `${still} not downloaded yet`
        : refused > 0 && build
          ? `${ready} ready to load, ${refused} will not load on ${build.label}`
          : "Everything is downloaded",
    body: notes.length > 0 ? notes.join(" ") : `${server.node.name} has the files for every mod in the list.`,
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
