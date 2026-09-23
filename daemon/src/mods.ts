import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PathError, resolveWithin } from "./files.ts";
import { cacheDirFor } from "./provision.ts";

/* What a game downloaded from the Workshop, read off this machine.

   The panel decides which Workshop items a server has, writes their ids
   into the game's own settings, and the game fetches them here on its
   next start. What the panel cannot know from Steam is the other half:
   what each download actually contains. A Workshop item is a bundle, and
   the name the game loads a mod by lives in a `mod.info` inside it —
   `id=LetMeThink`, not the item's number. Guessing it from a Workshop
   description is how a server ends up told to load a mod that is not
   there.

   So the panel asks the node, because the node is the only one holding
   the files. Nothing here downloads anything: it reads a directory the
   game filled, inside this server's own cache mount, and reads no file
   that is not a `mod.info`.

   It reports what is on disk and decides nothing. Project Zomboid's
   Build 42 keeps a mod's files in a folder per game version — `42.0/`,
   `42/` — beside a `common/` that every version reads, each with or
   without a `mod.info` of its own; Build 41 keeps one `mod.info` at the
   top of the mod's directory. Which of those a given build loads is a
   fact about that game, measured and kept in its definition on the
   panel, so this answers with every folder and every `mod.info` there
   is and leaves the choosing to the side that knows the server's build. */

export interface ModInfo {
  /** The folder it sits in, inside the mod's directory: "common", "42.0". Empty for one at the top. */
  folder: string;
  /** What goes in the game's load list: `id=`, or the mod's directory name when it has none. */
  id: string;
  /** What to show a person: `name=`, or the id when it has none. */
  name: string;
  /** The mod's own poster, relative to its folder. Null when it has none. */
  poster: string | null;
  /** `versionMin=` and `versionMax=`, as the author wrote them. Null when absent. */
  versionMin: string | null;
  versionMax: string | null;
  /** `require=`: the mod ids it says it needs, as written — Build 42 puts a `\` before each. */
  require: string[];
}

export interface InstalledMod {
  /** Its directory, under the item's `mods/` — or the item itself, in the oldest layout. */
  dir: string;
  /** Every folder directly inside that directory, sorted: "42.0", "common", "media". */
  folders: string[];
  /** Every mod.info in it: the one at its top, then one per folder that has its own. */
  infos: ModInfo[];
}

export interface InstalledItem {
  /** The Workshop item's id — the directory the game downloaded it into. */
  workshopId: string;
  /** Every mod inside it. Usually one; a pack is several. */
  mods: InstalledMod[];
}

/* A mod.info is a properties file the game writes and mods ship: lines
   of `key=value`, comments with `#`, and values that may contain `=`. The
   first of a repeated key wins, which is how `poster=` is read when a mod
   lists five. */
function parseModInfo(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim().toLowerCase();
    if (!(key in found)) found[key] = trimmed.slice(at + 1).trim();
  }
  return found;
}

/** A Workshop item's directory is its id. Anything else there is not ours to read. */
const ITEM_ID = /^\d{1,20}$/;

/* A mod's directory is named by its author, and Build 42 authors use
   spaces and apostrophes — "BuildingCraft Erika's tiles" is a real one.
   A name out of readdir cannot hold a separator on the node that wrote
   it, so what is refused here is what could still mean something else
   on the way: a backslash, a control character, a length no file system
   gives. Dots alone never come out of readdir. */
function readableName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && !/[\\/\u0000-\u001f]/.test(name);
}

/** Folders inside one mod's directory worth reporting; a mod is not a file tree. */
const MAX_FOLDERS = 64;

async function directories(dir: string): Promise<string[] | null> {
  try {
    /* Directories only, as readdir reports them: a symbolic link is not
       one, so nothing here follows a link out of the cache mount. */
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && readableName(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
}

async function readInfo(dir: string, folder: string, fallbackId: string): Promise<ModInfo | null> {
  const file = path.join(dir, folder, "mod.info");
  let text: string;
  try {
    /* A regular file, and a small one. A link could point anywhere on
       this machine, and a mod.info that is not small is not one: reading
       it whole would be somebody else's decision about this machine's
       memory. */
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > 64 * 1024) return null;
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }

  const info = parseModInfo(text);
  const id = info.id || fallbackId;
  return {
    folder,
    id,
    name: info.name || id,
    poster: info.poster || null,
    versionMin: info.versionmin || null,
    versionMax: info.versionmax || null,
    require: (info.require ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 64),
  };
}

async function modAt(root: string, dir: string): Promise<InstalledMod | null> {
  const full = path.join(root, dir);
  const folders = ((await directories(full)) ?? []).slice(0, MAX_FOLDERS);

  const infos: ModInfo[] = [];
  const top = await readInfo(full, "", dir);
  if (top) infos.push(top);
  for (const folder of folders) {
    const inside = await readInfo(full, folder, dir);
    if (inside) infos.push(inside);
  }

  // A directory with no mod.info anywhere in it is not a mod.
  return infos.length > 0 ? { dir, folders, infos } : null;
}

async function modsInside(itemDir: string): Promise<InstalledMod[]> {
  /* Both places the game puts mods: `<item>/mods/<ModId>/` is what
     Project Zomboid downloads today, and `<item>/<ModId>/` is what older
     items and hand-made ones have. */
  for (const root of [path.join(itemDir, "mods"), itemDir]) {
    const found: InstalledMod[] = [];
    for (const dir of (await directories(root)) ?? []) {
      const mod = await modAt(root, dir);
      if (mod) found.push(mod);
    }
    if (found.length > 0) return found;
  }
  return [];
}

/* Every Workshop item a server has downloaded, and what is in each.

   `mount` is the cache mount the game downloads into, as the workload
   sees it, and `at` is where under it the items land — both come from
   the game's definition, and both are checked here rather than trusted:
   the directory read is resolved inside this server's own cache mount
   and refused if it escapes, exactly as a file request is. */
export async function installedMods(
  dataRoot: string,
  serverId: string,
  mount: string,
  at: string,
): Promise<InstalledItem[]> {
  if (!mount.startsWith("/")) throw new PathError("the mount point must be absolute");
  const cacheDir = cacheDirFor(dataRoot, serverId, mount);
  const inside = at.startsWith(mount) ? at.slice(mount.length) : at;
  const contentDir = await resolveWithin(cacheDir, inside || "/");

  /* Nothing downloaded yet is not a fault: it is a server that has not
     started since its mods were chosen. */
  const entries = (await directories(contentDir)) ?? [];

  const items: InstalledItem[] = [];
  for (const workshopId of entries.filter((name) => ITEM_ID.test(name))) {
    items.push({ workshopId, mods: await modsInside(path.join(contentDir, workshopId)) });
  }
  return items;
}
