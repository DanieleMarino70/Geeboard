import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readlink, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { NotFoundError, PathError } from "./fs-errors.ts";

/* Getting to a file under a server's folder, so that nothing inside the folder can send the agent outside it.

   The agent is root on the machine, and a game's own process (a mod, a community game's image) can write to its folder, make
   links in it and rename its directories, all while the agent is working. resolveWithin checks a path and returns it; the
   caller then opens it again, by name, and in between a directory that was a directory can have become a link to the
   host's /etc. A check followed by a use is a race, however carefully the check was made.

   So there is no second use of a name. The walk opens the root, and then each component of the path *relative to the
   directory it has just opened*, as a directory and without following a link (O_DIRECTORY | O_NOFOLLOW). A link it meets is read
   and followed by hand: a target inside the folder is a path to walk again from the root, one that leaves it is refused. What
   comes out is the directory that holds the last component, held open, and a name in it: every later operation is made on
   that name through the open directory, so the directory it lands in is the one that was checked, whatever has been done to
   the names above it since. Linux has openat for this and Node has no openat, so the descriptor is named through /proc/self/fd,
   which is how the kernel lets a path be made relative to one. Elsewhere (the Windows agent) the old check is all there is, and
   files.ts keeps it for that. */

export const BENEATH_AVAILABLE = process.platform === "linux";

/** How many links a path may go through before it is a loop: Linux's own number. */
const MAX_LINKS = 40;

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

export interface Located {
  /** The directory that holds the last component, open. Closed by close(). */
  dir: FileHandle;
  /** The last component's name, which is not a link; empty for the root itself. */
  name: string;
  /** Where to open, rename or remove it: through the directory that was checked, not by a name that can be taken. */
  at: string;
  /** Where that is from the server's root, with every link resolved: what a caller reports. */
  logical: string[];
  close(): Promise<void>;
}

const through = (dir: FileHandle, name?: string) => `/proc/self/fd/${dir.fd}${name ? `/${name}` : ""}`;

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

function escapes(): never {
  throw new PathError("path escapes the server directory through a link");
}

/* The parts of a link's target, from the server's root, or a refusal. Relative is read from the directory the link is in
   (`inside`), and may go up as long as it does not go above the root; absolute is read as the machine reads it, and has to land
   in the root's real path. */
function afterLink(inside: string[], target: string, realRoot: string): string[] {
  if (target.startsWith("/")) {
    const relative = path.posix.relative(realRoot, path.posix.normalize(target));
    if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) escapes();
    return relative === "" ? [] : relative.split("/");
  }
  const joined = path.posix.normalize([...inside, target].join("/"));
  if (joined === ".." || joined.startsWith("../")) escapes();
  return joined === "." ? [] : joined.split("/");
}

/** The components of a request, the way resolveWithin reads one: one separator, root-relative, and nothing above the root. */
export function partsOf(requested: string): string[] {
  if (requested.includes("\0")) throw new PathError("path contains a null byte");
  const relative = requested.replace(/\\/g, "/").replace(/^\/+/, "");
  const normal = path.posix.normalize(relative === "" ? "." : relative);
  if (normal === ".." || normal.startsWith("../")) throw new PathError("path escapes the server directory");
  return normal === "." ? [] : normal.split("/").filter((p) => p !== "");
}

/* The directory holding `requested`'s last component, and that component's name.

   `create` makes the directories on the way as it meets them (and says nothing of the last component, which is the caller's
   to make). A last component that is a link is followed like the others, so what comes back is never one, and a caller that
   opens it with O_NOFOLLOW is refused only if it was swapped for a link after this looked; `followLast: false` is for the
   caller that means the link itself (to replace it with a file, to remove it, to move it), which gets its name as it is. */
export async function locate(root: string, requested: string, options: { create?: boolean; followLast?: boolean } = {}): Promise<Located> {
  const followLast = options.followLast !== false;
  const realRoot = await realpath(root).catch(() => {
    throw new NotFoundError("no such server directory");
  });
  let queue = partsOf(requested);
  let links = 0;

  for (;;) {
    const logical: string[] = [];
    let dir = await open(realRoot, DIRECTORY);
    let restart: string[] | null = null;
    try {
      let at = 0;
      while (at < queue.length) {
        const name = queue[at]!;
        const last = at === queue.length - 1;
        if (!last) {
          let next: FileHandle;
          try {
            next = await open(through(dir, name), DIRECTORY);
          } catch (error) {
            const code = codeOf(error);
            if (code === "ELOOP" || code === "ENOTDIR") {
              const target = await readlink(through(dir, name)).catch(() => null);
              if (target === null) throw new PathError("that is not a directory");
              if (++links > MAX_LINKS) throw new PathError("too many links on the way");
              restart = [...afterLink(logical, target, realRoot), ...queue.slice(at + 1)];
              break;
            }
            if (code === "ENOENT") {
              if (!options.create) throw new NotFoundError("no such directory");
              await mkdir(through(dir, name), { mode: 0o755 }).catch((e: unknown) => {
                if (codeOf(e) !== "EEXIST") throw e;
              });
              continue; // opened again, as a directory and without following: a link put there meanwhile is refused above
            }
            throw error;
          }
          await dir.close();
          dir = next;
          logical.push(name);
          at++;
          continue;
        }

        // The last component: what it is decides whether the walk goes on through it.
        const info = await lstat(through(dir, name)).catch((e: unknown) => {
          if (codeOf(e) === "ENOENT") return null;
          throw e;
        });
        if (info?.isSymbolicLink() && followLast) {
          const target = await readlink(through(dir, name));
          if (++links > MAX_LINKS) throw new PathError("too many links on the way");
          restart = afterLink(logical, target, realRoot);
          break;
        }
        const held = dir;
        dir = null as unknown as FileHandle; // given away: not closed here
        return {
          dir: held,
          name,
          at: through(held, name),
          logical,
          close: () => held.close(),
        };
      }

      if (restart === null) {
        // The root itself, or a path that ended on a directory it walked into: the directory is the thing asked for.
        const held = dir;
        dir = null as unknown as FileHandle;
        return { dir: held, name: "", at: through(held), logical, close: () => held.close() };
      }
    } finally {
      if (dir) await dir.close().catch(() => undefined);
    }
    queue = restart;
  }
}

/* Opening through a located directory, as a file, without following a link: a swap for one is an error, not an escape.

   And only a regular file. A game's process can make a FIFO where the agent expects a config (`mkfifo server.properties`, which needs no
   privilege): an open for reading then blocks inside open(2) on a thread the process cannot get back — the libuv pool has four, and four
   of them stall every file call the agent makes — and a device node (`mknod`) reports a size of 0, which passes every size cap and
   streams for ever. O_NONBLOCK turns the first into an error (ENXIO for a write, an immediate open for a read), and the descriptor is
   asked what it is before anything is read from it or written to it. */
export async function openFile(located: Located, flags: number, mode = 0o644): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(located.at, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, mode);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ELOOP") throw new PathError("the path changed while it was being opened: try again");
    if (code === "ENXIO") throw new PathError("not a regular file");
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) throw new PathError("not a regular file");
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  return handle;
}

/* The located thing, as a directory, for as long as `use` takes. The root itself is the directory that was opened, and is used
   as it is: its `at` names the descriptor, which a no-follow open would refuse as the link it is. */
export async function withDirectory<T>(located: Located, use: (dir: FileHandle) => Promise<T>): Promise<T> {
  if (located.name === "") return use(located.dir);
  let handle: FileHandle;
  try {
    handle = await open(located.at, DIRECTORY);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ELOOP") throw new PathError("the path changed while it was being opened: try again");
    if (code === "ENOTDIR") throw new PathError("not a directory");
    if (code === "ENOENT") throw new NotFoundError("no such directory");
    throw error;
  }
  try {
    return await use(handle);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** What is at a located name, without following it, or null when nothing is. */
export async function lstatLocated(located: Located) {
  return lstat(located.at).catch((error: unknown) => {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  });
}

/** The path of a directory's entry, made through the descriptor. */
export { through as throughDirectory };

/* ── Walking a whole folder, through the directories that were checked ──────────────────────────────────────────────
   The archiver and the size count walk a world, which can be gigabytes and take minutes, and a game's process is running in it all the
   while. They used to list a directory, decide by what each name was at that moment, and open the name later: a directory swapped for a link
   in between sent them into the host's /etc, another server's world, or a backup, and the archive then held it (reproduced: a backup
   of one server contained a file of another). Here each directory is opened as a directory without following a link and every child is
   reached THROUGH that open directory, never by a name that can be taken: a child that has become a link is an error that skips it, and
   what is yielded names a file by the directory it is held in, so the caller's open (openThrough, below) is made in the directory that was
   walked. Linux only: elsewhere files.ts and backups.ts keep their old walk, which is what the Windows agent has always had. */

export interface Walked {
  /** Where to open it from, through the open directory that holds it: valid until the walk moves on. */
  at: string;
  /** From the server's root, with `/`. */
  relative: string;
  kind: "file" | "directory";
  mode: number;
  mtime: number;
}

/** A name that an entry has in a directory, for a person: from the root, with its parent directories. */
const joinRelative = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

/** Walks `rootPath` depth first, in name order, yielding a directory before what is in it. `skipped` is told what could not be read. */
export async function* walkBeneath(rootPath: string, skipped: (message: string) => void): AsyncGenerator<Walked> {
  const root = await open(rootPath, DIRECTORY);
  try {
    yield* walkHeld(root, "", skipped);
  } finally {
    await root.close().catch(() => undefined);
  }
}

async function* walkHeld(dir: FileHandle, relativeDir: string, skipped: (message: string) => void): AsyncGenerator<Walked> {
  let entries;
  try {
    entries = await readdir(through(dir), { withFileTypes: true });
  } catch (error) {
    // The root is the caller's to be told about; below it a directory can vanish.
    if (relativeDir === "") throw error;
    skipped(`${relativeDir}/ was skipped: ${codeOf(error) ?? "it could not be read"}`);
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const at = through(dir, entry.name);
    const relative = joinRelative(relativeDir, entry.name);
    // Not followed: a link out of the folder would put somebody else's data in the archive, and one that loops would never finish.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      let child: FileHandle;
      try {
        child = await open(at, DIRECTORY);
      } catch (error) {
        const code = codeOf(error);
        skipped(`${relative}/ was skipped: ${code === "ELOOP" || code === "ENOTDIR" ? "it became something else while the folder was being read" : (code ?? "it could not be read")}`);
        continue;
      }
      try {
        const info = await child.stat();
        yield { at, relative, kind: "directory", mode: info.mode, mtime: info.mtimeMs };
        yield* walkHeld(child, relative, skipped);
      } finally {
        await child.close().catch(() => undefined);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    yield { at, relative, kind: "file", mode: 0, mtime: 0 };
  }
}

/** Opens a file the walk yielded: not through a link, never blocking on a FIFO, and the caller asks the handle what it is. */
export async function openThrough(at: string): Promise<FileHandle> {
  return open(at, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
}

/** The size of a folder in bytes and files, through the same held directories, with the files of a directory asked about thirty-two at a time. */
export async function sizeBeneath(rootPath: string): Promise<{ bytes: number; files: number }> {
  const root = await open(rootPath, DIRECTORY);
  try {
    const totals = { bytes: 0, files: 0 };
    await sizeHeld(root, totals);
    return totals;
  } finally {
    await root.close().catch(() => undefined);
  }
}

const STATS_AT_ONCE = 32;

async function sizeHeld(dir: FileHandle, totals: { bytes: number; files: number }): Promise<void> {
  let entries;
  try {
    entries = await readdir(through(dir), { withFileTypes: true });
  } catch {
    return;
  }
  const names: string[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) folders.push(entry.name);
    else if (entry.isFile()) names.push(entry.name);
  }
  for (let from = 0; from < names.length; from += STATS_AT_ONCE) {
    const sizes = await Promise.all(
      names.slice(from, from + STATS_AT_ONCE).map((name) =>
        // lstat: a name that has become a link counts as the link and not what it points at; gone since the directory was read, not counted.
        lstat(through(dir, name)).then(
          (info) => (info.isFile() ? info.size : null),
          () => null,
        ),
      ),
    );
    for (const size of sizes) {
      if (size === null) continue;
      totals.bytes += size;
      totals.files++;
    }
  }
  for (const name of folders) {
    let child: FileHandle;
    try {
      child = await open(through(dir, name), DIRECTORY);
    } catch {
      continue;
    }
    try {
      await sizeHeld(child, totals);
    } finally {
      await child.close().catch(() => undefined);
    }
  }
}
