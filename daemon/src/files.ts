import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

  // Treat every request as relative to the root, whatever it looks like.
  const relative = requested.replace(/^[/\\]+/, "");
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
