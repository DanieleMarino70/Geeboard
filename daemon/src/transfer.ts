import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { BackupError, backupRoot } from "./backups.ts";
import { NotFoundError, PathError } from "./files.ts";

/* Moving an archive to and from an object store.

   The panel holds the store's credentials and signs a URL that allows
   one PUT or one GET of one object for a few minutes; the node is handed
   that URL and streams the bytes. So the credentials never reach a
   node, the bytes never pass through the panel, and a URL that leaks is
   worth one object for a quarter of an hour.

   node:http rather than fetch, for one reason: an upload has to carry
   Content-Length. fetch streams a body chunked, and an S3-compatible
   store answers a chunked unsigned upload with an error. A plain
   request with the length set streams the file as it is. */

const ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar\.gz$/;

function archivePath(dataRoot: string, serverId: string, artifact: string): string {
  if (!ARTIFACT.test(artifact) || artifact.includes("..")) {
    throw new PathError("that is not a valid archive name");
  }
  return path.join(backupRoot(dataRoot, serverId), artifact);
}

/* A URL the panel signed. Only http(s), and never to a loopback or
   link-local address the node itself might be serving something on: the
   panel is trusted, but a URL is still input, and a node must not be
   turned into a proxy for its own metadata service. */
function parseTarget(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BackupError("the transfer URL is not a URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BackupError("the transfer URL must be http or https");
  }
  if (/^169\.254\./.test(parsed.hostname) || parsed.hostname === "metadata.google.internal") {
    throw new BackupError("the transfer URL points at a link-local address");
  }
  return parsed;
}

const TRANSFER_TIMEOUT_MS = 30 * 60_000;

function client(url: URL) {
  return url.protocol === "https:" ? https : http;
}

/* Uploads an archive that is already on the node. The store's answer is
   the whole verdict: a 2xx means it holds exactly Content-Length bytes
   of what was sent, and anything else is failure with the store's own
   words. The local file is left where it was; the panel decides. */
export async function uploadArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
  url: string,
): Promise<{ sizeBytes: number; etag: string | null; durationMs: number }> {
  const started = Date.now();
  const source = archivePath(dataRoot, serverId, artifact);
  const target = parseTarget(url);

  let info;
  try {
    info = await stat(source);
  } catch {
    throw new NotFoundError("no such archive");
  }

  return new Promise((resolve, reject) => {
    const req = client(target).request(
      target,
      {
        method: "PUT",
        headers: { "content-length": String(info.size), "content-type": "application/gzip" },
        timeout: TRANSFER_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.length < 64 && chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({
              sizeBytes: info.size,
              etag: typeof res.headers.etag === "string" ? res.headers.etag : null,
              durationMs: Date.now() - started,
            });
          } else {
            reject(new BackupError(`the store refused the upload (${status}): ${summary(chunks)}`));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new BackupError("the upload timed out")));
    req.on("error", (error) => reject(error instanceof BackupError ? error : new BackupError(`upload failed: ${error.message}`)));
    pipeline(createReadStream(source), req).catch((error) => {
      req.destroy();
      reject(error instanceof BackupError ? error : new BackupError(`upload failed: ${error.message}`));
    });
  });
}

/* Downloads an archive into the node's backup directory, hashing it on
   the way in. A checksum the panel recorded when the archive was made
   is checked before the file is allowed to exist: a download that does
   not match is removed, not restored from. */
export async function downloadArchive(
  dataRoot: string,
  serverId: string,
  artifact: string,
  url: string,
  expectedChecksum?: string,
): Promise<{ sizeBytes: number; checksum: string; durationMs: number }> {
  const started = Date.now();
  const destination = archivePath(dataRoot, serverId, artifact);
  const target = parseTarget(url);
  await mkdir(path.dirname(destination), { recursive: true });

  const hash = createHash("sha256");
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    const req = client(target).request(target, { method: "GET", timeout: TRANSFER_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.length < 64 && chunks.push(c));
        res.on("end", () => reject(new BackupError(`the store refused the download (${status}): ${summary(chunks)}`)));
        return;
      }
      res.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        size += chunk.length;
      });
      pipeline(res, createWriteStream(destination)).then(resolve, reject);
    });
    req.on("timeout", () => req.destroy(new BackupError("the download timed out")));
    req.on("error", (error) => reject(error instanceof BackupError ? error : new BackupError(`download failed: ${error.message}`)));
    req.end();
  }).catch(async (error) => {
    await rm(destination, { force: true });
    throw error;
  });

  const checksum = `sha256:${hash.digest("hex")}`;
  if (expectedChecksum && checksum !== expectedChecksum) {
    await rm(destination, { force: true });
    throw new BackupError("the downloaded archive does not match the checksum recorded when it was made");
  }
  return { sizeBytes: size, checksum, durationMs: Date.now() - started };
}

/* The store's error body, as much of it as is worth repeating: S3
   answers with a short XML document naming the code. */
function summary(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString("utf8").replace(/\s+/g, " ").trim();
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
  return code ? `${code}${message ? ` — ${message}` : ""}` : text.slice(0, 200) || "no detail";
}
