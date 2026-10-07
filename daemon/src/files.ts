import { randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream, type Stats } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BENEATH_AVAILABLE, locate, lstatLocated, openFile, throughDirectory, withDirectory } from "./beneath.ts";
import { NotFoundError, PathError } from "./fs-errors.ts";

export { NotFoundError, PathError };

/* Server file access.

   Every server owns a directory under the data root and must never be
   able to reach outside it. That is the whole job of this file: the
   read and write calls are trivial, the containment is not.

   On Linux every operation goes through beneath.ts, which walks the path one directory at a time, never following a link
   it has not read, and does the work in the directory it opened: nothing inside the folder can change what a name means
   between the check and the use. The *Legacy functions are what there was before — resolveWithin, then open by name — and are
   what runs where there is no /proc (the Windows agent), and resolveWithin is still what mods.ts asks. */

export interface Entry {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string;
  mode: string;
}

/** The directory a server owns. Never taken from the request. */
export function rootFor(dataRoot: string, serverId: string): string {
  // A server id reaching this point is from the panel, not a browser,
  // but it still becomes a path segment — so it is checked like one.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(serverId)) {
    throw new PathError("invalid server id");
  }
  return path.resolve(dataRoot, serverId);
}

/* Resolves a request path inside a server's root, refusing anything
   that escapes it.

   Containment is checked twice, deliberately. The lexical check rejects
   the obvious traversal; the realpath check catches a symlink pointing
   out of the tree, which no amount of string handling would see. */
export async function resolveWithin(root: string, requested: string): Promise<string> {
  if (requested.includes("\0")) throw new PathError("path contains a null byte");

  /* A backslash is a separator here on every platform, not only where
     the operating system says so. `path.resolve` treats `..\..\etc` as
     one strange file name on Linux and as a traversal on Windows, so the
     same request meant two different things on two nodes — and the test
     that was meant to catch it passed on Windows for that reason alone.
     One rule: the panel sends `/`, and anything that looks like a
     separator is one. */
  const relative = requested.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(root, relative);

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new PathError("path escapes the server directory");
  }

  /* Resolve symlinks on the deepest part that exists — the target
     itself when writing to an existing file, its parent when creating
     a new one. */
  let probe = target;
  let existing: string | null = null;
  while (probe.startsWith(rootWithSep) || probe === root) {
    try {
      existing = await realpath(probe);
      break;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }

  if (existing) {
    const realRoot = await realpath(root).catch(() => root);
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    if (existing !== realRoot && !existing.startsWith(realRootWithSep)) {
      throw new PathError("path escapes the server directory through a link");
    }
  }

  return target;
}

function modeString(mode: number): string {
  const bits = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const octal = (mode & 0o777).toString(8).padStart(3, "0");
  return octal
    .split("")
    .map((d) => bits[Number(d)] ?? "---")
    .join("");
}

export async function ensureRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
}

async function listLegacy(root: string, requested: string): Promise<Entry[]> {
  const dir = await resolveWithin(root, requested);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError("no such directory");
    }
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new PathError("not a directory");
    }
    throw error;
  }

  const out = await Promise.all(
    entries.map(async (entry): Promise<Entry> => {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      let info;
      try {
        info = await stat(full);
      } catch {
        // A broken symlink still deserves a row rather than a crash.
        return {
          name: entry.name,
          path: rel,
          kind: "other",
          sizeBytes: 0,
          modifiedAt: new Date(0).toISOString(),
          mode: "---------",
        };
      }
      return {
        name: entry.name,
        path: rel,
        kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        mode: modeString(info.mode),
      };
    }),
  );

  // Directories first, then by name — the order a file manager shows.
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : b.kind === "directory" ? 1 : 0;
    return a.name.localeCompare(b.name);
  });
}

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

async function readLegacy(
  root: string,
  requested: string,
  maxBytes = MAX_EDIT_BYTES,
): Promise<{ content: string; sizeBytes: number; truncated: boolean }> {
  const file = await resolveWithin(root, requested);

  let info;
  try {
    info = await stat(file);
  } catch {
    throw new NotFoundError("no such file");
  }
  if (info.isDirectory()) throw new PathError("that is a directory");

  /* A world file is gigabytes; refusing is kinder than streaming it into
     a textarea that will never render it. */
  if (info.size > maxBytes) {
    return { content: "", sizeBytes: info.size, truncated: true };
  }

  return {
    content: await readFile(file, "utf8"),
    sizeBytes: info.size,
    truncated: false,
  };
}

async function writeLegacy(root: string, requested: string, content: string): Promise<Entry> {
  if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) {
    throw new PathError("file is too large to write through the panel");
  }

  const file = await resolveWithin(root, requested);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");

  const info = await stat(file);
  return {
    name: path.basename(file),
    path: path.relative(root, file).split(path.sep).join("/"),
    kind: "file",
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    mode: modeString(info.mode),
  };
}

/* Bytes, not text: a plugin jar, a world icon, a zip of a map.

   The text pair above is for a person editing a config in a browser and
   stops at two megabytes. This pair is for a program moving a file, and
   is streamed both ways so its size is a limit on the disk and the wire
   rather than on memory. It still has a ceiling — a world is what
   backups are for, and an upload with none is a way to fill a node's
   disk with one request — and it goes through the same containment as
   everything else here. */
export const MAX_RAW_BYTES = 256 * 1024 * 1024;

async function openForReadLegacy(
  root: string,
  requested: string,
): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number; name: string }> {
  const file = await resolveWithin(root, requested);
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new NotFoundError("no such file");
  }
  if (info.isDirectory()) throw new PathError("that is a directory");
  if (info.size > MAX_RAW_BYTES) {
    throw new PathError(`that file is ${info.size} bytes; files over ${MAX_RAW_BYTES} are not served. A backup is how a world leaves a node.`);
  }
  return { stream: createReadStream(file), sizeBytes: info.size, name: path.basename(file) };
}

/* Written beside the target and renamed over it, so a connection that
   drops half-way leaves the file that was there rather than half of a
   new one — a truncated plugin jar is a server that will not start.

   `expected` is the size the uploader said it was sending, when it said.
   A stream can also end cleanly and early: something between the browser
   and here stopped passing bytes and closed as if that were all of them.
   That happened — the panel's own framework cut every upload at 10 MB and
   reported success, and a Terraria world arrived as its first 10 MB — so
   a count that is not the one promised is refused before the rename, and
   the file that was there stays. */
async function writeFromStreamLegacy(
  root: string,
  requested: string,
  source: NodeJS.ReadableStream,
  expected?: number,
): Promise<Entry> {
  const file = await resolveWithin(root, requested);
  if (file === root) throw new PathError("a file needs a name");
  try {
    if ((await stat(file)).isDirectory()) throw new PathError("that is a directory");
  } catch (error) {
    if (error instanceof PathError) throw error;
  }

  await mkdir(path.dirname(file), { recursive: true });
  /* Written in a directory of its own beside the servers', under a name
     nobody can guess, and moved to the file when it is whole. It used to sit
     beside the target as `<file>.<pid>.<ms>.upload`, which the Files page
     showed, the next backup included, and nothing ever swept when the agent
     was killed half-way; and a name anyone could predict is one a game's own
     process could plant a link at. leftovers.ts clears what a kill leaves. */
  const uploads = path.join(path.dirname(root), ".uploads", path.basename(root));
  await mkdir(uploads, { recursive: true });
  const temporary = path.join(uploads, `${randomBytes(8).toString("hex")}.upload`);
  let written = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      done(written > MAX_RAW_BYTES ? new PathError(`uploads stop at ${MAX_RAW_BYTES} bytes`) : null, chunk);
    },
  });

  try {
    await pipeline(source, limit, createWriteStream(temporary, { flags: "wx" }));
    if (expected !== undefined && written !== expected) {
      throw new PathError(
        `the upload ended at ${written} of ${expected} bytes, so nothing was written: something between the browser and this node cut it short`,
      );
    }
    try {
      await rename(temporary, file);
    } catch (error) {
      // A server directory on another filesystem than the data root: a rename cannot cross it, a copy can.
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(temporary, file);
      await rm(temporary, { force: true });
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  const info = await stat(file);
  return {
    name: path.basename(file),
    path: path.relative(root, file).split(path.sep).join("/"),
    kind: "file",
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    mode: modeString(info.mode),
  };
}

async function makeDirectoryLegacy(root: string, requested: string): Promise<void> {
  const dir = await resolveWithin(root, requested);
  if (dir === root) throw new PathError("cannot create the server root");
  await mkdir(dir, { recursive: true });
}

async function removeLegacy(root: string, requested: string): Promise<void> {
  const target = await resolveWithin(root, requested);
  // Deleting the root would take the server's whole world with it.
  if (target === root) throw new PathError("cannot delete the server root");

  try {
    await access(target, constants.F_OK);
  } catch {
    throw new NotFoundError("no such file or directory");
  }
  await rm(target, { recursive: true, force: false });
}

/* How much a server's directory holds, on disk.

   Symlinks are counted as themselves and never followed, for the reason
   backups skip them: a link out of the directory would count somebody
   else's data, and a link that loops would never finish. A file that
   vanishes mid-walk — a world saving — is simply not counted.

   The files of a directory are asked about thirty-two at a time: a world with tens of thousands of small files (a mature Project Zomboid
   one) waited on one `stat` after another. */
const STATS_AT_ONCE = 32;

export async function directorySize(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const pending = [root];

  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const found: string[] = [];
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (entry.isFile()) found.push(absolute);
    }
    for (let at = 0; at < found.length; at += STATS_AT_ONCE) {
      const sizes = await Promise.all(
        found.slice(at, at + STATS_AT_ONCE).map((file) =>
          stat(file).then(
            (s) => s.size,
            // gone since the directory was read
            () => null,
          ),
        ),
      );
      for (const size of sizes) {
        if (size === null) continue;
        bytes += size;
        files++;
      }
    }
  }
  return { bytes, files };
}

async function moveLegacy(root: string, from: string, to: string): Promise<void> {
  const source = await resolveWithin(root, from);
  const destination = await resolveWithin(root, to);
  if (source === root) throw new PathError("cannot move the server root");

  try {
    await access(source, constants.F_OK);
  } catch {
    throw new NotFoundError("no such file or directory");
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
}

/* ── On Linux: through the directory that was checked ─────────────────────────── */

const EPOCH = new Date(0).toISOString();

function entryFrom(name: string, logical: string, info: Stats): Entry {
  return {
    name,
    path: logical,
    kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
    sizeBytes: Number(info.size),
    modifiedAt: info.mtime.toISOString(),
    mode: modeString(Number(info.mode)),
  };
}

/** What a name inside the folder is, followed through links that stay inside it; null for a link that does not, or points at nothing. */
async function statBeneath(root: string, logical: string): Promise<Stats | null> {
  try {
    const located = await locate(root, logical);
    try {
      return await lstatLocated(located);
    } finally {
      await located.close();
    }
  } catch (error) {
    if (error instanceof PathError || error instanceof NotFoundError) return null;
    throw error;
  }
}

async function listBeneath(root: string, requested: string): Promise<Entry[]> {
  const located = await locate(root, requested);
  try {
    return await withDirectory(located, async (dir) => {
      const entries = await readdir(throughDirectory(dir), { withFileTypes: true });
      const base = [...located.logical, ...(located.name ? [located.name] : [])];
      const out = await Promise.all(
        entries.map(async (entry): Promise<Entry> => {
          const logical = [...base, entry.name].join("/");
          const row = (info: Stats) => entryFrom(entry.name, logical, info);
          const unknown: Entry = { name: entry.name, path: logical, kind: "other", sizeBytes: 0, modifiedAt: EPOCH, mode: "---------" };
          let info;
          try {
            info = await lstat(throughDirectory(dir, entry.name));
          } catch {
            return unknown;
          }
          if (!info.isSymbolicLink()) return row(info);
          // A link is described as what it points at only when that is inside the folder: what is outside is not ours to describe.
          const target = await statBeneath(root, logical);
          return target ? row(target) : unknown;
        }),
      );
      // Directories first, then by name — the order a file manager shows.
      return out.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : b.kind === "directory" ? 1 : 0;
        return a.name.localeCompare(b.name);
      });
    });
  } finally {
    await located.close();
  }
}

async function readBeneath(root: string, requested: string, maxBytes: number): Promise<{ content: string; sizeBytes: number; truncated: boolean }> {
  const located = await locate(root, requested);
  try {
    let handle;
    try {
      handle = await openFile(located, constants.O_RDONLY);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("no such file");
      throw error;
    }
    try {
      const info = await handle.stat();
      if (info.isDirectory()) throw new PathError("that is a directory");
      /* A world file is gigabytes; refusing is kinder than streaming it into a textarea that will never render it. */
      if (info.size > maxBytes) return { content: "", sizeBytes: info.size, truncated: true };
      return { content: await handle.readFile("utf8"), sizeBytes: info.size, truncated: false };
    } finally {
      await handle.close();
    }
  } finally {
    await located.close();
  }
}

const isDirectoryError = (error: unknown) => (error as NodeJS.ErrnoException).code === "EISDIR";

async function writeBeneath(root: string, requested: string, content: string): Promise<Entry> {
  if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) {
    throw new PathError("file is too large to write through the panel");
  }
  const located = await locate(root, requested, { create: true });
  try {
    if (located.name === "") throw new PathError("that is a directory");
    let handle;
    try {
      handle = await openFile(located, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o644);
    } catch (error) {
      if (isDirectoryError(error)) throw new PathError("that is a directory");
      throw error;
    }
    try {
      await handle.writeFile(content, "utf8");
      return entryFrom(located.name, [...located.logical, located.name].join("/"), await handle.stat());
    } finally {
      await handle.close();
    }
  } finally {
    await located.close();
  }
}

async function openForReadBeneath(
  root: string,
  requested: string,
): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number; name: string }> {
  const located = await locate(root, requested);
  try {
    let handle;
    try {
      handle = await openFile(located, constants.O_RDONLY);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError("no such file");
      throw error;
    }
    const info = await handle.stat();
    if (info.isDirectory()) {
      await handle.close();
      throw new PathError("that is a directory");
    }
    if (info.size > MAX_RAW_BYTES) {
      await handle.close();
      throw new PathError(`that file is ${info.size} bytes; files over ${MAX_RAW_BYTES} are not served. A backup is how a world leaves a node.`);
    }
    // The stream owns the handle from here and closes it at the end.
    return { stream: handle.createReadStream({ autoClose: true }), sizeBytes: info.size, name: located.name };
  } finally {
    await located.close();
  }
}

async function writeFromStreamBeneath(
  root: string,
  requested: string,
  source: NodeJS.ReadableStream,
  expected?: number,
): Promise<Entry> {
  // The last component is not followed: an upload replaces whatever name is there, a link included, as a rename always did.
  const located = await locate(root, requested, { create: true, followLast: false });
  try {
    if (located.name === "") throw new PathError("a file needs a name");
    if ((await lstatLocated(located))?.isDirectory()) throw new PathError("that is a directory");

    /* Written in a directory of its own beside the servers', under a name nobody can guess, opened to be made and never to be
       reused (wx), and moved to the file when it is whole. Never beside the target, where a game's own process could plant a
       link at a name it could predict. leftovers.ts clears what a kill leaves. */
    const uploads = path.join(path.dirname(root), ".uploads", path.basename(root));
    await mkdir(uploads, { recursive: true });
    const temporary = path.join(uploads, `${randomBytes(8).toString("hex")}.upload`);
    let written = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        written += chunk.length;
        done(written > MAX_RAW_BYTES ? new PathError(`uploads stop at ${MAX_RAW_BYTES} bytes`) : null, chunk);
      },
    });

    try {
      await pipeline(source, limit, createWriteStream(temporary, { flags: "wx" }));
      if (expected !== undefined && written !== expected) {
        throw new PathError(
          `the upload ended at ${written} of ${expected} bytes, so nothing was written: something between the browser and this node cut it short`,
        );
      }
      try {
        // Through the directory that was checked: a rename puts the file there, and a name above it that has since become a link changes nothing.
        await rename(temporary, located.at);
      } catch (error) {
        // A server directory on another filesystem than the data root: a rename cannot cross it, a copy can — made as a new file, never through a link.
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await unlink(located.at).catch((e: unknown) => {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        });
        const out = await openFile(located, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
        try {
          await pipeline(createReadStream(temporary), out.createWriteStream({ autoClose: false }));
        } finally {
          await out.close();
        }
        await rm(temporary, { force: true });
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    const info = await lstatLocated(located);
    if (!info) throw new NotFoundError("the file was removed as it was written");
    return entryFrom(located.name, [...located.logical, located.name].join("/"), info);
  } finally {
    await located.close();
  }
}

async function makeDirectoryBeneath(root: string, requested: string): Promise<void> {
  const located = await locate(root, requested, { create: true });
  try {
    if (located.name === "") throw new PathError("cannot create the server root");
    try {
      await mkdir(located.at, { mode: 0o755 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await lstatLocated(located))?.isDirectory()) throw new PathError("a file with that name is there already");
    }
  } finally {
    await located.close();
  }
}

async function removeBeneath(root: string, requested: string): Promise<void> {
  // The link itself, not what it points at, when the name is a link.
  const located = await locate(root, requested, { followLast: false });
  try {
    // Deleting the root would take the server's whole world with it.
    if (located.name === "") throw new PathError("cannot delete the server root");
    if (!(await lstatLocated(located))) throw new NotFoundError("no such file or directory");
    await rm(located.at, { recursive: true, force: false });
  } finally {
    await located.close();
  }
}

async function moveBeneath(root: string, from: string, to: string): Promise<void> {
  const source = await locate(root, from, { followLast: false });
  try {
    const destination = await locate(root, to, { create: true, followLast: false });
    try {
      if (source.name === "") throw new PathError("cannot move the server root");
      if (destination.name === "") throw new PathError("cannot move onto the server root");
      if (!(await lstatLocated(source))) throw new NotFoundError("no such file or directory");
      await rename(source.at, destination.at);
    } finally {
      await destination.close();
    }
  } finally {
    await source.close();
  }
}

/* ── What the rest of the agent calls ─────────────────────────────────────────── */

export const list = (root: string, requested: string): Promise<Entry[]> => (BENEATH_AVAILABLE ? listBeneath(root, requested) : listLegacy(root, requested));

export const read = (root: string, requested: string, maxBytes = MAX_EDIT_BYTES): Promise<{ content: string; sizeBytes: number; truncated: boolean }> =>
  BENEATH_AVAILABLE ? readBeneath(root, requested, maxBytes) : readLegacy(root, requested, maxBytes);

export const write = (root: string, requested: string, content: string): Promise<Entry> =>
  BENEATH_AVAILABLE ? writeBeneath(root, requested, content) : writeLegacy(root, requested, content);

export const openForRead = (root: string, requested: string): Promise<{ stream: NodeJS.ReadableStream; sizeBytes: number; name: string }> =>
  BENEATH_AVAILABLE ? openForReadBeneath(root, requested) : openForReadLegacy(root, requested);

export const writeFromStream = (root: string, requested: string, source: NodeJS.ReadableStream, expected?: number): Promise<Entry> =>
  BENEATH_AVAILABLE ? writeFromStreamBeneath(root, requested, source, expected) : writeFromStreamLegacy(root, requested, source, expected);

export const makeDirectory = (root: string, requested: string): Promise<void> =>
  BENEATH_AVAILABLE ? makeDirectoryBeneath(root, requested) : makeDirectoryLegacy(root, requested);

export const remove = (root: string, requested: string): Promise<void> => (BENEATH_AVAILABLE ? removeBeneath(root, requested) : removeLegacy(root, requested));

export const move = (root: string, from: string, to: string): Promise<void> =>
  BENEATH_AVAILABLE ? moveBeneath(root, from, to) : moveLegacy(root, from, to);
