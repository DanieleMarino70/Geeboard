import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { link, mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createGzip, createGunzip } from "node:zlib";
import { BENEATH_AVAILABLE, openThrough, walkBeneath } from "./beneath.ts";
import { NotFoundError, PathError, directorySize, rootFor } from "./files.ts";
import { logger } from "./log.ts";

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

/* `code` is what a restore tells the panel about the world it was asked to
   replace, in a word the panel can act on: "restore-untouched" says the
   world on this node is exactly as it was, "restore-incomplete" says it is
   not. Anything that fails before the world is touched is the first. */
export type RestoreStage = "restore-untouched" | "restore-incomplete";

export class BackupError extends Error {
  constructor(
    message: string,
    readonly code?: RestoreStage,
  ) {
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
  /** Things that happened to the world while it was read and did not stop the backup: a file that shrank, one that vanished. */
  warnings: string[];
}

export interface ArchiveEntry {
  artifact: string;
  sizeBytes: number;
  createdAt: string;
}

const BLOCK = 512;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

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

/* ── Room ─────────────────────────────────────────────────────────── */

export interface Space {
  free: number;
  total: number;
}

/** What the disk under a directory has. Injectable, so a test does not need a full disk. */
export type SpaceReader = (directory: string) => Promise<Space>;

const readSpace: SpaceReader = async (directory) => {
  const info = await statfs(directory);
  return { free: Number(info.bavail) * Number(info.bsize), total: Number(info.blocks) * Number(info.bsize) };
};

/* What is kept free beside any backup or restore, so the other servers on
   the node can go on writing: the larger of 2 GiB and 5 percent of the disk.
   Archives live on the disk the worlds live on, and a backup that fills it
   stops every world on the node mid-write. GEEBOARD_BACKUP_FLOOR_BYTES sets
   it by hand — for a small disk, or a test. */
export function floorFor(total: number, env: NodeJS.ProcessEnv = process.env): number {
  const given = env.GEEBOARD_BACKUP_FLOOR_BYTES;
  if (given !== undefined && given.trim() !== "") {
    const set = Number(given);
    if (Number.isFinite(set) && set >= 0) return Math.floor(set);
  }
  return Math.max(2 * GIB, Math.floor(total * 0.05));
}

export function describeBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / MIB))} MB`;
}

export interface BackupDeps {
  space?: SpaceReader;
  /** Called with each file just after it is opened for archiving, before a byte is read: where a test changes a "live" world. */
  afterOpen?: (file: string) => Promise<void>;
  /** How much is written between looks at the disk while unpacking. */
  checkEveryBytes?: number;
}

/* ── Writing ──────────────────────────────────────────────────────── */

export async function createArchive(
  dataRoot: string,
  serverId: string,
  name: string,
  deps: BackupDeps = {},
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
  await assertRoomToArchive(source, path.dirname(destination), deps.space ?? readSpace);

  /* Written beside the archive under a name nothing lists, and moved to its
     own only when it is whole. A process killed mid-archive used to leave a
     partial with a valid name and a date: it looked like a backup, and the
     panel would have restored it. The random part is also what keeps two
     requests for one name from writing the same file. */
  const partial = `${destination}.partial.${randomBytes(6).toString("hex")}`;
  const warnings: string[] = [];

  /* The digest is taken from the compressed bytes on their way to disk,
     not by reading the file back afterwards. One pass, and the checksum
     describes exactly what was written rather than what a later read
     happened to find. */
  const hash = createHash("sha256");
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    /* One pipeline, so a failure anywhere — the disk filling, the gzip, the
       walk — tears down every stage. The feeder used to be a separate loop
       that waited for a drain that never came, holding the file it was
       reading, when the destination failed. */
    await pipeline(Readable.from(tarChunks(source, warnings, deps)), createGzip({ level: 6 }), hasher, createWriteStream(partial, { flags: "wx" }));
    await moveIntoPlace(partial, destination);
  } catch (error) {
    // A half-written archive is worse than none: it looks like a backup.
    await rm(partial, { force: true });
    throw error;
  }

  const info = await stat(destination);
  return {
    artifact,
    sizeBytes: info.size,
    checksum: `sha256:${hash.digest("hex")}`,
    durationMs: Date.now() - started,
    warnings,
  };
}

/* Refuses a backup the disk cannot hold with the numbers, rather than letting
   it fail as a raw "no space left on device" halfway through a world and
   leave every other server on the node writing to a full disk. gzip usually
   shrinks a world, so the estimate is the world's own size: conservative. */
async function assertRoomToArchive(source: string, destinationDir: string, space: SpaceReader): Promise<void> {
  const { bytes } = await directorySize(source);
  const { free, total } = await space(destinationDir);
  const floor = floorFor(total);
  if (free < bytes + floor) {
    throw new BackupError(
      `this backup needs about ${describeBytes(bytes + floor)}: the world is ${describeBytes(bytes)} and ${describeBytes(floor)} is kept free so the other servers on this node can go on writing. The node has ${describeBytes(free)} free. Free some space, or move older backups off the node`,
    );
  }
}

/* Gives a finished partial its name without ever replacing an archive that
   is already there: a hard link fails when the name is taken. Where links are
   not available the rename does the job. */
async function moveIntoPlace(partial: string, destination: string): Promise<void> {
  try {
    await link(partial, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BackupError("an archive with that name already exists on this node");
    }
    await rename(partial, destination);
    return;
  }
  await rm(partial, { force: true });
}

/* Walks a directory, yielding tar blocks.

   A generator rather than a buffer, because a Minecraft world is
   gigabytes and holding one in memory on a node running a dozen servers
   is how a backup takes the machine down with it.

   The world is live. A file is opened first and everything about it taken
   from that handle, so the header's size is the size of the file that is
   actually read, and exactly that many bytes are read: a log that grows
   while it is archived is archived as it was when it was opened, one that
   shrinks is padded and reported, and one that is gone is skipped and
   reported. A tar is positional, so a file that disagreed with its own header
   would have corrupted every entry after it — which is why this used to fail
   the whole backup instead. */
async function* tarChunks(root: string, warnings: string[], deps: BackupDeps): AsyncGenerator<Buffer> {
  for await (const entry of entriesOf(root, warnings)) {
    if (entry.kind === "directory") {
      yield* headers(entry.relative + "/", 0, "5", entry.mode, entry.mtime);
      continue;
    }

    let handle: FileHandle;
    try {
      // On Linux through the directory the walk is holding: a name that has become a link is refused, a FIFO does not block, and the check
      // below asks the handle what it is. Elsewhere by name, which is what the Windows agent has always done.
      handle = BENEATH_AVAILABLE ? await openThrough(entry.at) : await open(entry.at, "r");
    } catch (error) {
      warnings.push(`${entry.relative} was skipped: ${(error as NodeJS.ErrnoException).code ?? "it could not be opened"}`);
      continue;
    }

    try {
      const info = await handle.stat();
      await deps.afterOpen?.(entry.absolute);
      if (!info.isFile()) {
        warnings.push(`${entry.relative} was skipped: it is not a file any more`);
        continue;
      }
      const size = info.size;
      yield* headers(entry.relative, size, "0", info.mode, info.mtimeMs);

      let written = 0;
      if (size > 0) {
        for await (const chunk of handle.createReadStream({ start: 0, end: size - 1, autoClose: false })) {
          written += (chunk as Buffer).length;
          yield chunk as Buffer;
        }
      }
      if (written < size) {
        warnings.push(`${entry.relative} shrank while it was being archived (${size} to ${written} bytes) and is padded with zeros`);
        yield Buffer.alloc(size - written);
      } else if ((await handle.stat()).size > size) {
        warnings.push(`${entry.relative} grew while it was being archived; the archive has its first ${size} bytes`);
      }

      const remainder = size % BLOCK;
      if (remainder !== 0) yield Buffer.alloc(BLOCK - remainder);
    } finally {
      await handle.close().catch(() => {});
    }
  }

  // Two zero blocks mark the end of the archive.
  yield Buffer.alloc(BLOCK * 2);
}

/* What the walk yields. `at` is what a file is opened by: on Linux a name inside a directory the walk has open (beneath.ts, which says why),
   elsewhere the path. `absolute` is the path as a person would write it, for the tests' hook and for nothing that opens anything. */
interface Walked {
  at: string;
  absolute: string;
  relative: string;
  kind: "file" | "directory";
  mode: number;
  mtime: number;
}

/* The world, as entries: through held directories where the kernel allows it (a game's process can swap a directory for a link while this
   runs, and the archive then held another server's world or the agent's token: reproduced), by name where it does not. */
async function* entriesOf(root: string, warnings: string[]): AsyncGenerator<Walked> {
  if (BENEATH_AVAILABLE) {
    for await (const entry of walkBeneath(root, (message) => warnings.push(message))) yield { ...entry, absolute: path.join(root, entry.relative) };
    return;
  }
  yield* walk(root, root, warnings);
}

async function* walk(root: string, dir: string, warnings: string[]): AsyncGenerator<Walked> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // The root is checked before this runs; below it, a directory can vanish.
    if (dir === root) throw error;
    warnings.push(`${path.relative(root, dir).split(path.sep).join("/")}/ was skipped: ${(error as NodeJS.ErrnoException).code ?? "it could not be read"}`);
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");

    /* Symlinks are skipped rather than followed. Following one would
       copy whatever it points at into the archive — which for a link
       out of the server's directory means backing up somebody else's
       data, and for a link that loops means never finishing. */
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      let info;
      try {
        info = await stat(absolute);
      } catch (error) {
        warnings.push(`${relative}/ was skipped: ${(error as NodeJS.ErrnoException).code ?? "it could not be read"}`);
        continue;
      }
      yield { at: absolute, absolute, relative, kind: "directory", mode: info.mode, mtime: info.mtimeMs };
      yield* walk(root, absolute, warnings);
      continue;
    }

    if (!entry.isFile()) continue;
    // Everything about a file is read from the handle it is opened with.
    yield { at: absolute, absolute, relative, kind: "file", mode: 0, mtime: 0 };
  }
}

/* The header blocks for one entry.

   A USTAR name field holds 100 bytes, and a Minecraft server's
   `libraries/` directory has paths of nearly 150 — so every Minecraft
   backup used to fail on its first long one. A longer path goes in a PAX
   extended header just before the entry, which is the POSIX way to
   carry it and what GNU tar, bsdtar and Python read. The name field then
   holds as much of the path as fits, for a reader that knows no better. */
function* headers(
  name: string,
  size: number,
  type: string,
  mode: number,
  mtimeMs: number,
): Generator<Buffer> {
  if (Buffer.byteLength(name) > 100) {
    const record = paxRecord("path", name);
    yield header("././@PaxHeader", record.length, "x", 0o644, mtimeMs);
    yield record;
    const remainder = record.length % BLOCK;
    if (remainder !== 0) yield Buffer.alloc(BLOCK - remainder);
  }
  yield header(name, size, type, mode, mtimeMs);
}

/* One PAX record: "<length> <key>=<value>\n", where the length counts
   its own digits — so it is found by trying until it stops changing. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body);
  while (Buffer.byteLength(`${length}${body}`) !== length) {
    length = Buffer.byteLength(`${length}${body}`);
  }
  return Buffer.from(`${length}${body}`, "utf8");
}

/* One 512-byte USTAR header.

   The checksum field is computed with itself read as spaces, which is
   the one genuinely strange rule in the format and the one every
   hand-written tar gets wrong first. */
function header(name: string, size: number, type: string, mode: number, mtimeMs: number): Buffer {
  const block = Buffer.alloc(BLOCK, 0);

  // Truncated to the field; see headers() for where a long path goes.
  // Buffer.write never splits a multi-byte character.
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

export interface RestoreOptions {
  /** Replace the world first and unpack after, for a node without room for both. A failure then leaves the world incomplete. */
  inPlace?: boolean;
}

export interface RestoreResult {
  files: number;
  /** "swapped": unpacked beside the world and exchanged for it whole. "in-place": the old world was removed first. */
  mode: "swapped" | "in-place";
}

/* Unpacks an archive back over a server's directory.

   The existing directory is replaced, not merged into. A restore that
   merged would leave files the backup does not contain — a corrupt region
   file, a plugin someone added since — and the whole point of a restore is
   to get back to a state that is known.

   It used to be emptied first, before anyone knew the archive would unpack:
   a truncated archive, a full disk or a bad write error left a partial world
   and, on a write error, a dead agent. So the archive is unpacked into a
   directory beside the world, and the two are exchanged by rename only when
   the whole of it has been written. Anything that fails before the exchange
   removes the staging directory and leaves the world exactly as it was; the
   error says so, with a code the panel reads. The in-place mode is for a node
   with no room for two copies, asked for by name, and says what it risks.

   Every path is resolved inside the server's own root and refused if it
   escapes, exactly as the file API does. An archive is untrusted input
   even when the panel produced it, because nothing here can prove the
   bytes on disk are the ones it wrote. */
export async function restoreArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
  expectedChecksum?: string,
  options: RestoreOptions = {},
  deps: BackupDeps = {},
): Promise<RestoreResult> {
  const target = artifactPath(dataRoot, serverId, artifact);
  const root = rootFor(dataRoot, serverId);
  const space = deps.space ?? readSpace;
  const checkEvery = deps.checkEveryBytes ?? SPACE_CHECK_EVERY;

  const untouched = (message: string) =>
    new BackupError(`${message}. Nothing was changed: the world on this node is exactly as it was`, "restore-untouched");

  // Before anything is touched: the archive is there, and is the one the panel recorded.
  let info;
  try {
    info = await stat(target);
  } catch {
    throw untouched("no such archive on this node");
  }
  if (expectedChecksum) {
    const { checksum } = await verifyArchive(dataRoot, serverId, artifact);
    if (checksum !== expectedChecksum) {
      throw untouched("the archive does not match the checksum recorded when it was made; refusing to restore it");
    }
  }

  const needed = await uncompressedSizeOf(target, info.size);
  const present = await stat(root).then(() => true, () => false);
  const { free, total } = await space(path.dirname(root));
  const floor = floorFor(total);

  if (!options.inPlace) {
    if (free < needed + floor) {
      const world = present ? (await directorySize(root)).bytes : 0;
      const inPlace = present && free + world >= needed + Math.min(floor, 512 * MIB);
      throw untouched(
        `restoring needs about ${describeBytes(needed + floor)}${present ? " beside the current world, which is replaced only once the archive has unpacked completely" : ""}, including ${describeBytes(floor)} kept free; the node has ${describeBytes(free)} free. ` +
          (inPlace ? "Free some space, or restore in place, which removes the world first and leaves it incomplete if the restore then fails" : "Free some space first"),
      );
    }
    return restoreSwapped(root, target, space, checkEvery, untouched);
  }

  const world = present ? (await directorySize(root)).bytes : 0;
  if (free + world < needed + Math.min(floor, 512 * MIB)) {
    throw untouched(`restoring needs about ${describeBytes(needed)} and even without the current world the node would have ${describeBytes(free + world)}; free some space first`);
  }
  return restoreInPlace(root, target, space, checkEvery);
}

async function restoreSwapped(
  root: string,
  target: string,
  space: SpaceReader,
  checkEvery: number,
  untouched: (message: string) => BackupError,
): Promise<RestoreResult> {
  const suffix = randomBytes(6).toString("hex");
  const staging = `${root}.restoring-${suffix}`;
  const aside = `${root}.replaced-${suffix}`;

  let files: number;
  try {
    await mkdir(staging, { recursive: true });
    files = await extractInto(staging, target, space, checkEvery);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw untouched(describeFailure(error));
  }

  const hadWorld = await stat(root).then(() => true, () => false);
  try {
    if (hadWorld) await rename(root, aside);
    await rename(staging, root);
  } catch (error) {
    // Put back what was moved aside. If even that fails the old world is at `aside`, and the sweep at start-up moves it back.
    const restored = hadWorld ? await rename(aside, root).then(() => true, () => false) : true;
    await rm(staging, { recursive: true, force: true });
    if (restored) throw untouched(`the restored world could not be put in place (${describeFailure(error)})`);
    throw new BackupError(
      `the restored world could not be put in place and the previous one could not be put back (${describeFailure(error)}); it is at ${aside}`,
      "restore-incomplete",
    );
  }

  // The old world is the last thing to go, and a failure to remove it is not a failed restore.
  if (hadWorld) {
    await rm(aside, { recursive: true, force: true }).catch((error) =>
      logger.warn("the previous world could not be removed after a restore", { path: aside, detail: describeFailure(error) }),
    );
  }
  return { files, mode: "swapped" };
}

async function restoreInPlace(root: string, target: string, space: SpaceReader, checkEvery: number): Promise<RestoreResult> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  try {
    return { files: await extractInto(root, target, space, checkEvery), mode: "in-place" };
  } catch (error) {
    throw new BackupError(
      `${describeFailure(error)}. The world on this node was removed before the restore began, so what is on disk is incomplete: restore again (the archive is untouched) before starting the server`,
      "restore-incomplete",
    );
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "Z_BUF_ERROR" || /unexpected end of file/i.test(error.message)) return "the archive is cut short";
    if (code === "ENOSPC") return "the disk is full";
    return error.message;
  }
  return "the restore failed";
}

/* The uncompressed size, from the last four bytes of a gzip file, which are
   it modulo 2^32. A world over 4 GiB reads wrong, so the estimate is never
   less than the archive itself — and the unpacking checks the disk as it goes
   for the case the estimate is low. */
async function uncompressedSizeOf(file: string, compressed: number): Promise<number> {
  const handle = await open(file, "r");
  try {
    const tail = Buffer.alloc(4);
    await handle.read(tail, 0, 4, Math.max(0, compressed - 4));
    return Math.max(tail.readUInt32LE(0), compressed);
  } finally {
    await handle.close();
  }
}

/* The default for how much is written between looks at the disk while unpacking. */
const SPACE_CHECK_EVERY = 256 * MIB;

/* A file being written. The error listener is on from the first byte —
   attached when the entry ended it was too late: a write error in between was
   an uncaught exception, which killed the agent — and a failure is seen by the
   next write rather than at the end. */
class FileSink {
  private readonly stream: WriteStream;
  private failure: Error | null = null;

  constructor(file: string) {
    this.stream = createWriteStream(file);
    this.stream.on("error", (error) => {
      this.failure ??= error;
    });
  }

  async write(chunk: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    if (!this.stream.write(chunk)) await once(this.stream, "drain");
    if (this.failure) throw this.failure;
  }

  async close(): Promise<void> {
    if (this.failure) throw this.failure;
    this.stream.end();
    await finished(this.stream);
  }

  destroy(): void {
    this.stream.destroy();
  }
}

/* Unpacks `archive` into `directory`, which exists and is empty. Resolves with
   the number of files; rejects, with every file closed, at the first problem —
   a bad header, a path out of the directory, a truncated gzip, a write error,
   a disk about to fill. */
async function extractInto(directory: string, archive: string, space: SpaceReader, checkEvery: number): Promise<number> {
  let files = 0;
  let written = 0;
  let checkedAt = 0;
  let pending: Buffer = Buffer.alloc(0);
  let current: Payload | null = null;
  /* A path from a metadata entry — PAX or GNU — waiting for the entry it
     describes, which is the next one. */
  let longName: string | null = null;
  /* An archive ends with two zero blocks. Stopping at the first is not
     enough — the second would be read as a header with an empty name,
     which resolves to the server's own directory and fails as EISDIR. */
  let ended = false;
  const { total } = await space(directory);
  const hardFloor = Math.min(floorFor(total), 512 * MIB);

  const put = async (sink: FileSink, chunk: Buffer) => {
    await sink.write(chunk);
    written += chunk.length;
    if (written - checkedAt >= checkEvery) {
      checkedAt = written;
      const { free } = await space(directory);
      if (free < hardFloor) throw new BackupError(`the disk is about to fill (${describeBytes(free)} left)`);
    }
  };

  /* pipeline() settles with whichever error reaches it first, and tearing a
     stream down can put an AbortError ahead of the real reason. The first
     problem the unpacking itself hits is kept and is what is thrown. */
  let problem: unknown = null;

  const consume = async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      if (ended) continue;
      pending = Buffer.concat([pending, chunk]);

      while (!ended) {
        if (current) {
          if (current.remaining > 0) {
            if (pending.length === 0) break;
            const take = Math.min(current.remaining, pending.length);
            if (current.kind === "file") await put(current.sink, pending.subarray(0, take));
            else current.chunks.push(Buffer.from(pending.subarray(0, take)));
            pending = pending.subarray(take);
            current.remaining -= take;
            if (current.remaining > 0) break;
          }

          // The payload is padded to a block boundary; skip the padding
          // before the next header can be read.
          if (pending.length < current.padding) break;
          pending = pending.subarray(current.padding);
          if (current.kind === "file") {
            await current.sink.close();
            files++;
          } else {
            longName = nameFromMetadata(current.type, Buffer.concat(current.chunks)) ?? longName;
          }
          current = null;
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

        let name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
        const size =
          parseInt(block.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(), 8) || 0;
        const type = block.subarray(156, 157).toString("ascii");
        const padding = (BLOCK - (size % BLOCK)) % BLOCK;

        /* Entries that describe the next one rather than being one: a PAX
           header (ours, for a long path), a PAX global header, a GNU long
           name. Held in memory, so their size is capped — an archive is
           untrusted input. */
        if (type === "x" || type === "g" || type === "L") {
          if (size > MAX_METADATA_BYTES) {
            throw new BackupError("the archive has a metadata entry too large to be one");
          }
          current = { kind: "meta", type, chunks: [], remaining: size, padding };
          continue;
        }

        if (longName !== null) {
          name = longName;
          longName = null;
        } else if (block.subarray(257, 262).toString("ascii") === "ustar") {
          // USTAR's own way to go past 100 bytes, which other tools write.
          const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
          if (prefix) name = `${prefix}/${name}`;
        }

        const destination = safeJoin(directory, name);
        if (type === "5") {
          await mkdir(destination, { recursive: true });
          continue;
        }

        await mkdir(path.dirname(destination), { recursive: true });
        const sink = new FileSink(destination);

        if (size === 0) {
          await sink.close();
          files++;
          continue;
        }
        current = { kind: "file", sink, remaining: size, padding };
      }
    }
  };

  try {
    await pipeline(createReadStream(archive), createGunzip(), async (source: AsyncIterable<Buffer>) => {
      try {
        await consume(source);
      } catch (error) {
        problem ??= error;
        throw error;
      }
    });
  } catch (error) {
    // Whatever was open when it failed.
    if (current && (current as Payload).kind === "file") (current as Extract<Payload, { kind: "file" }>).sink.destroy();
    throw problem ?? error;
  }

  if (current) throw new BackupError("the archive ended part-way through a file");
  /* Every archive this agent writes ends with its two zero blocks. One that
     ends without them was cut short at an entry boundary, which a gzip stream
     alone does not show. */
  if (!ended) throw new BackupError("the archive ended without its end marker; it was cut short");
  return files;
}

type Payload =
  | { kind: "file"; sink: FileSink; remaining: number; padding: number }
  | { kind: "meta"; type: string; chunks: Buffer[]; remaining: number; padding: number };

/* A path is a few hundred bytes; a megabyte of metadata is not a path. */
const MAX_METADATA_BYTES = 1024 * 1024;

/* The path a metadata entry gives the entry after it, if it gives one. */
function nameFromMetadata(type: string, payload: Buffer): string | null {
  if (type === "L") return payload.toString("utf8").replace(/\0[\s\S]*$/, "");
  if (type !== "x") return null;

  // PAX records: "<length> <key>=<value>\n", the length counting itself.
  let path: string | null = null;
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    const length = space === -1 ? NaN : Number(payload.subarray(offset, space).toString("ascii"));
    if (!Number.isInteger(length) || length <= space - offset || offset + length > payload.length) {
      throw new BackupError("the archive has a malformed extended header");
    }
    const record = payload.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0 && record.slice(0, equals) === "path") path = record.slice(equals + 1);
    offset += length;
  }
  return path;
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
