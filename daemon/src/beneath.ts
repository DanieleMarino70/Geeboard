import { constants } from "node:fs";
import { lstat, mkdir, open, readlink, realpath, type FileHandle } from "node:fs/promises";
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

/** Opening through a located directory, as a file, without following a link: a swap for one is an error, not an escape. */
export async function openFile(located: Located, flags: number, mode = 0o644): Promise<FileHandle> {
  try {
    return await open(located.at, flags | constants.O_NOFOLLOW, mode);
  } catch (error) {
    if (codeOf(error) === "ELOOP") throw new PathError("the path changed while it was being opened: try again");
    throw error;
  }
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
