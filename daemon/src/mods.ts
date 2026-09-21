import { readdir, readFile, stat } from "node:fs/promises";
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
   there, which for Project Zomboid is a refusal to start.

   So the panel asks the node, because the node is the only one holding
   the files. Nothing here downloads anything: it reads a directory the
   game filled, inside this server's own cache mount, and reads no file
   that is not a `mod.info`. */

export interface InstalledMod {
  /** What goes in the game's load list: `id=` in mod.info. */
  id: string;
  /** What to show a person: `name=`, or the id when it has none. */
  name: string;
  /** The mod's own poster, relative to its directory. Null when it has none. */
  poster: string | null;
}

export interface InstalledItem {
  /** The Workshop item's id — the directory the game downloaded it into. */
  workshopId: string;
  /** Every mod inside it. Usually one; a pack is several. */
  mods: InstalledMod[];
}

/* A mod.info is a properties file the game writes and mods ship: lines
   of `key=value`, comments with `#`, and values that may contain `=`. */
function parseModInfo(text: string): { id: string | null; name: string | null; poster: string | null } {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at <= 0) continue;
    const key = trimmed.slice(0, at).trim().toLowerCase();
    if (!(key in found)) found[key] = trimmed.slice(at + 1).trim();
  }
  return { id: found.id ?? null, name: found.name ?? null, poster: found.poster ?? null };
}

/** Directory names the game writes; anything else is not ours to read. */
const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/;

async function modsInside(itemDir: string): Promise<InstalledMod[]> {
  /* Both layouts the game uses: `<item>/mods/<ModId>/mod.info` is what
     Project Zomboid downloads today, and `<item>/<ModId>/mod.info` is
     what older items and hand-made ones have. */
  const roots = [path.join(itemDir, "mods"), itemDir];
  const found: InstalledMod[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    let entries: string[];
    try {
      entries = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const name of entries) {
      let text: string;
      try {
        const file = path.join(root, name, "mod.info");
        /* A mod.info is small; a file that is not is not one, and
           reading it whole would be somebody else's decision about this
           machine's memory. */
        if ((await stat(file)).size > 64 * 1024) continue;
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }

      const info = parseModInfo(text);
      const id = info.id ?? name;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({ id, name: info.name ?? id, poster: info.poster ?? null });
    }
    if (found.length > 0) break;
  }

  return found;
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

  let entries: string[];
  try {
    entries = (await readdir(contentDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SAFE_NAME.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    /* Nothing downloaded yet is not a fault: it is a server that has not
       started since its mods were chosen. */
    return [];
  }

  const items: InstalledItem[] = [];
  for (const workshopId of entries.sort()) {
    items.push({ workshopId, mods: await modsInside(path.join(contentDir, workshopId)) });
  }
  return items;
}
