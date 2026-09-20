import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/* Server file access.

   Every server owns a directory under the data root and must never be
   able to reach outside it. That is the whole job of this file: the
   read and write calls are trivial, the containment is not. */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

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

export async function list(root: string, requested: string): Promise<Entry[]> {
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

export async function read(
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

export async function write(root: string, requested: string, content: string): Promise<Entry> {
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

export async function openForRead(
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
   new one — a truncated plugin jar is a server that will not start. */
export async function writeFromStream(
  root: string,
  requested: string,
  source: NodeJS.ReadableStream,
): Promise<Entry> {
  const file = await resolveWithin(root, requested);
  if (file === root) throw new PathError("a file needs a name");
  try {
    if ((await stat(file)).isDirectory()) throw new PathError("that is a directory");
  } catch (error) {
    if (error instanceof PathError) throw error;
  }

  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.upload`;
  let written = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      done(written > MAX_RAW_BYTES ? new PathError(`uploads stop at ${MAX_RAW_BYTES} bytes`) : null, chunk);
    },
  });

  try {
    await pipeline(source, limit, createWriteStream(temporary));
    await rename(temporary, file);
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

export async function makeDirectory(root: string, requested: string): Promise<void> {
  const dir = await resolveWithin(root, requested);
  if (dir === root) throw new PathError("cannot create the server root");
  await mkdir(dir, { recursive: true });
}

export async function remove(root: string, requested: string): Promise<void> {
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
   vanishes mid-walk — a world saving — is simply not counted. */
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
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        bytes += (await stat(absolute)).size;
        files++;
      } catch {
        /* gone since the directory was read */
      }
    }
  }
  return { bytes, files };
}

export async function move(root: string, from: string, to: string): Promise<void> {
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
