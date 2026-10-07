import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "./log.ts";

/* What a process that was killed leaves behind, and what puts it right.

   Three things are written beside the data and moved into place only when
   they are whole: an archive (`<name>.tar.gz.partial.<random>`, in
   .backups/<server>/), a file being uploaded (`<random>.upload`, in
   .uploads/<server>/) and a world being restored (`<server>.restoring-<random>`
   next to the world, with the old one set aside as `<server>.replaced-<random>`
   for the moment of the exchange). A clean failure removes its own. A kill -9, a
   power cut or an out-of-memory kill removes nothing, and until now nothing
   else did: a silent leak that compounds a full disk.

   At start-up nothing is in flight — this process has only just begun — so
   everything of these kinds is the leavings of one that did not finish, and goes.
   Afterwards, only what has not been touched for a while does, so that a restore
   or an upload that is slow and alive is not swept from under itself.

   One more case is not a leftover but a rescue: a world set aside for the
   exchange whose replacement never arrived. The server's directory is missing and
   its previous contents are right there under another name; they are moved back. */

export interface SweepOptions {
  /** True when called as the agent starts: nothing is in flight, so no age is waited for. */
  startup?: boolean;
  now?: number;
}

export interface SweepResult {
  removed: string[];
  recovered: string[];
}

const HOUR = 3600_000;

/* How long since anything under this path last changed: the path itself and
   what is directly inside it. A directory's own time moves only when an entry
   is added or removed in it, so a world being unpacked into a subdirectory is
   alive in the child's time and not in its parent's. */
async function ageOf(target: string, now: number): Promise<number | null> {
  const info = await stat(target).catch(() => null);
  if (!info) return null;
  let newest = info.mtimeMs;
  if (info.isDirectory()) {
    for (const name of (await readdir(target).catch(() => [])).slice(0, 200)) {
      const child = await stat(path.join(target, name)).catch(() => null);
      if (child && child.mtimeMs > newest) newest = child.mtimeMs;
    }
  }
  return now - newest;
}

async function list(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => []);
}

export async function sweepLeftovers(dataRoot: string, options: SweepOptions = {}): Promise<SweepResult> {
  const now = options.now ?? Date.now();
  const result: SweepResult = { removed: [], recovered: [] };
  const idle = (hours: number) => (options.startup ? 0 : hours * HOUR);

  const drop = async (target: string, minIdleMs: number) => {
    const age = await ageOf(target, now);
    if (age === null || age < minIdleMs) return;
    await rm(target, { recursive: true, force: true });
    result.removed.push(path.relative(dataRoot, target).split(path.sep).join("/"));
  };

  // Archives and uploads that were never finished.
  for (const server of await list(path.join(dataRoot, ".backups"))) {
    for (const name of await list(path.join(dataRoot, ".backups", server))) {
      if (name.includes(".tar.gz.partial.")) await drop(path.join(dataRoot, ".backups", server, name), idle(3));
    }
  }
  for (const server of await list(path.join(dataRoot, ".uploads"))) {
    for (const name of await list(path.join(dataRoot, ".uploads", server))) {
      if (name.endsWith(".upload")) await drop(path.join(dataRoot, ".uploads", server, name), idle(3));
    }
  }

  // Worlds being restored, and worlds set aside for it.
  for (const name of await list(dataRoot)) {
    const staging = /^(.+)\.restoring-[0-9a-f]+$/.exec(name);
    if (staging) {
      await drop(path.join(dataRoot, name), idle(6));
      continue;
    }
    const aside = /^(.+)\.replaced-[0-9a-f]+$/.exec(name);
    if (!aside) continue;
    const world = path.join(dataRoot, aside[1]!);
    const asidePath = path.join(dataRoot, name);
    if (!(await stat(world).catch(() => null))) {
      // The exchange was interrupted between its two renames: the world is missing, and this is it.
      await rename(asidePath, world);
      result.recovered.push(aside[1]!);
      continue;
    }
    // The exchange finished and the old world's removal did not: it is not needed, and it is a whole world's worth of disk.
    await drop(asidePath, idle(24));
  }

  if (result.removed.length > 0) logger.info("removed what an interrupted operation left behind", { count: result.removed.length, paths: result.removed.slice(0, 10).join(", ") });
  if (result.recovered.length > 0) logger.warn("put a world back that an interrupted restore had set aside", { servers: result.recovered.join(", ") });
  return result;
}
