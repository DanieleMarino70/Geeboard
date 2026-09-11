import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { NotFoundError, PathError, rootFor } from "./files.ts";

/* Archiving a server's world.

   The file API next door is for reading and editing text — 2 MB, one
   file at a time, so a browser can open a config. This is the other
   thing entirely: gigabytes of world data, streamed, never held in
   memory, and never handed to a browser at all.

   Written by hand rather than with a tar library, for one reason: the
   only dependencies this agent has are Docker and a WebSocket, and
   adding an archive format to that list to write a few hundred lines of
   POSIX header is a bad trade. Tar is a header and a payload, padded to
   512 bytes. It is genuinely this small. */

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export interface ArchiveResult {
  /** What the node calls this archive. Opaque to the panel. */
  artifact: string;
  sizeBytes: number;
  /** sha256 of the archive, computed as it was written. */
  checksum: string;
  durationMs: number;
}

export interface ArchiveEntry {
  artifact: string;
  sizeBytes: number;
  createdAt: string;
}

const BLOCK = 512;

/** Where a node keeps its archives. Beside the data, never inside it. */
export function backupRoot(dataRoot: string, serverId: string): string {
  // Same validation as the data root: this becomes a path segment.
  const server = rootFor(dataRoot, serverId);
  return path.resolve(path.dirname(server), ".backups", path.basename(server));
}

/* An artifact name the caller cannot use to write anywhere else.

   The panel picks the name, which means it is untrusted input that
   becomes a filename. Refusing anything but the shape we generate is
   cheaper and safer than trying to sanitise what arrives. */
const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar\.gz$/;

function artifactPath(dataRoot: string, serverId: string, artifact: string): string {
  if (!ARTIFACT.test(artifact) || artifact.includes("..")) {
    throw new PathError("that is not a valid archive name");
  }
  return path.join(backupRoot(dataRoot, serverId), artifact);
}

/* ── Writing ──────────────────────────────────────────────────────── */

export async function createArchive(
  dataRoot: string,
  serverId: string,
  name: string,
): Promise<ArchiveResult> {
  const started = Date.now();
  const source = rootFor(dataRoot, serverId);
  const artifact = `${sanitise(name)}.tar.gz`;
  const destination = artifactPath(dataRoot, serverId, artifact);

  try {
    await stat(source);
  } catch {
    throw new NotFoundError("that server has no data directory to archive");
  }

  await mkdir(path.dirname(destination), { recursive: true });

  /* The digest is taken from the compressed bytes on their way to disk,
     not by reading the file back afterwards. One pass, and the checksum
     describes exactly what was written rather than what a later read
     happened to find. */
  const hash = createHash("sha256");
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(destination);

  gzip.on("data", (chunk: Buffer) => hash.update(chunk));

  try {
    await Promise.all([
      pipeline(gzip, out),
      (async () => {
        for await (const chunk of tarChunks(source)) {
          if (!gzip.write(chunk)) {
            await new Promise((resolve) => gzip.once("drain", resolve));
          }
        }
        gzip.end();
      })(),
    ]);
  } catch (error) {
    // A half-written archive is worse than none: it looks like a backup.
    await rm(destination, { force: true });
    throw error;
  }

  const info = await stat(destination);
  return {
    artifact,
    sizeBytes: info.size,
    checksum: `sha256:${hash.digest("hex")}`,
    durationMs: Date.now() - started,
  };
}

/* Walks a directory, yielding tar blocks.

   A generator rather than a buffer, because a Minecraft world is
   gigabytes and holding one in memory on a node running a dozen servers
   is how a backup takes the machine down with it. */
async function* tarChunks(root: string): AsyncGenerator<Buffer> {
  for await (const entry of walk(root, root)) {
    if (entry.kind === "directory") {
      yield header(entry.relative + "/", 0, "5", entry.mode, entry.mtime);
      continue;
    }

    yield header(entry.relative, entry.size, "0", entry.mode, entry.mtime);

    let written = 0;
    for await (const chunk of createReadStream(entry.absolute)) {
      written += (chunk as Buffer).length;
      yield chunk as Buffer;
    }

    /* A file that changed size while we were reading it would corrupt
       every entry after it, because tar is positional. Refusing beats
       producing an archive that unpacks into nonsense. */
    if (written !== entry.size) {
      throw new BackupError(`${entry.relative} changed while it was being archived`);
    }

    const remainder = written % BLOCK;
    if (remainder !== 0) yield Buffer.alloc(BLOCK - remainder);
  }

  // Two zero blocks mark the end of the archive.
  yield Buffer.alloc(BLOCK * 2);
}

interface Walked {
  absolute: string;
  relative: string;
  kind: "file" | "directory";
  size: number;
  mode: number;
  mtime: number;
}

async function* walk(root: string, dir: string): AsyncGenerator<Walked> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");

    /* Symlinks are skipped rather than followed. Following one would
       copy whatever it points at into the archive — which for a link
       out of the server's directory means backing up somebody else's
       data, and for a link that loops means never finishing. */
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      const info = await stat(absolute);
      yield { absolute, relative, kind: "directory", size: 0, mode: info.mode, mtime: info.mtimeMs };
      yield* walk(root, absolute);
      continue;
    }

    if (!entry.isFile()) continue;
    const info = await stat(absolute);
    yield {
      absolute,
      relative,
      kind: "file",
      size: info.size,
      mode: info.mode,
      mtime: info.mtimeMs,
    };
  }
}

/* One 512-byte USTAR header.

   The checksum field is computed with itself read as spaces, which is
   the one genuinely strange rule in the format and the one every
   hand-written tar gets wrong first. */
function header(name: string, size: number, type: string, mode: number, mtimeMs: number): Buffer {
  const block = Buffer.alloc(BLOCK, 0);

  if (Buffer.byteLength(name) > 100) {
    throw new BackupError(`path too long to archive: ${name}`);
  }

  block.write(name, 0, 100, "utf8");
  block.write(octal(mode & 0o7777, 7), 100, 8, "ascii");
  block.write(octal(0, 7), 108, 8, "ascii");
  block.write(octal(0, 7), 116, 8, "ascii");
  block.write(octal(size, 11), 124, 12, "ascii");
  block.write(octal(Math.floor(mtimeMs / 1000), 11), 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write(type, 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

  return block;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width, "0")}\0`;
}

function sanitise(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return clean.length > 0 ? clean : `backup-${Date.now()}`;
}

/* ── Reading back ─────────────────────────────────────────────────── */

export async function listArchives(dataRoot: string, serverId: string): Promise<ArchiveEntry[]> {
  const root = backupRoot(dataRoot, serverId);

  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: ArchiveEntry[] = [];
  for (const name of names) {
    if (!ARTIFACT.test(name)) continue;
    const info = await stat(path.join(root, name)).catch(() => null);
    if (!info) continue;
    out.push({ artifact: name, sizeBytes: info.size, createdAt: info.mtime.toISOString() });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function removeArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
): Promise<void> {
  const target = artifactPath(dataRoot, serverId, artifact);
  try {
    await stat(target);
  } catch {
    throw new NotFoundError("no such archive");
  }
  await rm(target, { force: true });
}

/** Recomputes an archive's digest, for a restore that refuses to guess. */
export async function verifyArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
): Promise<{ checksum: string; sizeBytes: number }> {
  const target = artifactPath(dataRoot, serverId, artifact);

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new NotFoundError("no such archive");
  }

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
  return { checksum: `sha256:${hash.digest("hex")}`, sizeBytes: info.size };
}

/* Unpacks an archive back over a server's directory.

   The existing directory is emptied first. A restore that merged into
   what is there would leave files the backup does not contain — a
   corrupt region file, a plugin someone added since — and the whole
   point of a restore is to get back to a state that is known.

   Every path is resolved inside the server's own root and refused if it
   escapes, exactly as the file API does. An archive is untrusted input
   even when the panel produced it, because nothing here can prove the
   bytes on disk are the ones it wrote. */
export async function restoreArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
  expectedChecksum?: string,
): Promise<{ files: number }> {
  const target = artifactPath(dataRoot, serverId, artifact);
  const root = rootFor(dataRoot, serverId);

  if (expectedChecksum) {
    const { checksum } = await verifyArchive(dataRoot, serverId, artifact);
    if (checksum !== expectedChecksum) {
      throw new BackupError(
        "the archive does not match the checksum recorded when it was made; refusing to restore it",
      );
    }
  }

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  let files = 0;
  const gunzip = createGunzip();
  createReadStream(target).pipe(gunzip);

  /* Each file is streamed to disk, so the last write is still in flight
     when its entry is finished with. Collecting the finish promises and
     awaiting them at the end is what makes "restore returned" mean "the
     files are on disk" rather than "the parsing is done". */
  const flushed: Array<Promise<void>> = [];

  let pending = Buffer.alloc(0);
  let current: { handle: WriteStream; remaining: number; padding: number } | null = null;
  /* An archive ends with two zero blocks. Stopping at the first is not
     enough — the second would be read as a header with an empty name,
     which resolves to the server's own directory and fails as EISDIR. */
  let ended = false;

  for await (const chunk of gunzip) {
    if (ended) continue;
    pending = Buffer.concat([pending, chunk as Buffer]);

    while (!ended) {
      if (current) {
        if (current.remaining > 0) {
          if (pending.length === 0) break;
          const take = Math.min(current.remaining, pending.length);
          current.handle.write(pending.subarray(0, take));
          pending = pending.subarray(take);
          current.remaining -= take;
          if (current.remaining > 0) break;
        }

        // The payload is padded to a block boundary; skip the padding
        // before the next header can be read.
        if (pending.length < current.padding) break;
        pending = pending.subarray(current.padding);
        flushed.push(finish(current.handle));
        current = null;
        files++;
        continue;
      }

      if (pending.length < BLOCK) break;
      const block = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);

      // A real entry's name never starts with NUL, so a zero first byte
      // is the end-of-archive marker and nothing else.
      if (block[0] === 0) {
        ended = true;
        break;
      }

      const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
      const size =
        parseInt(block.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(), 8) || 0;
      const type = block.subarray(156, 157).toString("ascii");

      const destination = safeJoin(root, name);
      if (type === "5") {
        await mkdir(destination, { recursive: true });
        continue;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      const handle = createWriteStream(destination);

      if (size === 0) {
        flushed.push(finish(handle));
        files++;
        continue;
      }
      current = { handle, remaining: size, padding: (BLOCK - (size % BLOCK)) % BLOCK };
    }
  }

  if (current) {
    // Truncated archive: the last entry never got all its bytes.
    flushed.push(finish(current.handle));
    throw new BackupError("the archive ended part-way through a file");
  }

  await Promise.all(flushed);
  return { files };
}

function finish(handle: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.once("error", reject);
    handle.end(resolve);
  });
}

/* The same containment rule as the file API, for the same reason: an
   entry named ../../etc/something must not become a write outside the
   server's directory. */
function safeJoin(root: string, name: string): string {
  if (name.includes("\0")) throw new PathError("archive entry contains a null byte");
  const target = path.resolve(root, name.replace(/^[/\\]+/, ""));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new PathError(`archive entry escapes the server directory: ${name}`);
  }
  return target;
}
