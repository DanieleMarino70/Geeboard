import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { backupRoot } from "../src/backups.ts";
import { downloadArchive, uploadArchive } from "../src/transfer.ts";

/* Moving an archive to a store and back, against a small HTTP server
   playing the store: it keeps what it is PUT and serves it on GET, and
   it insists on what a real S3-compatible store insists on — a
   Content-Length, not a chunked body. */

const SERVER = "srv-transfer-test";
let dataRoot: string;
let base: string;
let store: http.Server;
const objects = new Map<string, Buffer>();
let sawChunked = false;

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-transfer-"));
  await mkdir(backupRoot(dataRoot, SERVER), { recursive: true });

  store = http.createServer((req, res) => {
    const key = req.url ?? "/";
    if (req.method === "PUT") {
      if (req.headers["transfer-encoding"] === "chunked" || !req.headers["content-length"]) sawChunked = true;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (key.includes("refuse")) {
          res.writeHead(403, { "content-type": "application/xml" });
          res.end("<Error><Code>AccessDenied</Code><Message>no</Message></Error>");
          return;
        }
        const body = Buffer.concat(chunks);
        objects.set(key, body);
        res.writeHead(200, { etag: `"${createHash("md5").update(body).digest("hex")}"` });
        res.end();
      });
      return;
    }
    if (req.method === "GET") {
      const body = objects.get(key);
      if (!body) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end("<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
      return;
    }
    res.writeHead(405);
    res.end();
  });
  await new Promise<void>((resolve) => store.listen(0, "127.0.0.1", resolve));
  const address = store.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(async () => {
  store.close();
  await rm(dataRoot, { recursive: true, force: true });
});

test("an archive goes up with its length and comes back down byte for byte", async () => {
  const bytes = Buffer.alloc(300_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 255;
  await writeFile(path.join(backupRoot(dataRoot, SERVER), "world.tar.gz"), bytes);

  const up = await uploadArchive(dataRoot, SERVER, "world.tar.gz", `${base}/bucket/srv/world.tar.gz?X-Amz-Signature=abc`);
  assert.equal(up.sizeBytes, bytes.length);
  assert.ok(up.etag, "the store's ETag is passed back");
  assert.equal(sawChunked, false, "sent with Content-Length, never chunked");
  assert.deepEqual(objects.get("/bucket/srv/world.tar.gz?X-Amz-Signature=abc"), bytes);

  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const down = await downloadArchive(dataRoot, SERVER, "world-back.tar.gz", `${base}/bucket/srv/world.tar.gz?X-Amz-Signature=abc`, checksum);
  assert.equal(down.sizeBytes, bytes.length);
  assert.equal(down.checksum, checksum);
  assert.deepEqual(await readFile(path.join(backupRoot(dataRoot, SERVER), "world-back.tar.gz")), bytes);
});

test("a download that does not match its checksum is removed, not kept", async () => {
  await assert.rejects(
    () => downloadArchive(dataRoot, SERVER, "bad.tar.gz", `${base}/bucket/srv/world.tar.gz?X-Amz-Signature=abc`, "sha256:0000"),
    /does not match the checksum/,
  );
  await assert.rejects(() => stat(path.join(backupRoot(dataRoot, SERVER), "bad.tar.gz")));
});

test("the store's refusal comes back in its own words", async () => {
  await assert.rejects(
    () => uploadArchive(dataRoot, SERVER, "world.tar.gz", `${base}/bucket/refuse/world.tar.gz`),
    /refused the upload \(403\): AccessDenied — no/,
  );
  await assert.rejects(
    () => downloadArchive(dataRoot, SERVER, "missing.tar.gz", `${base}/bucket/srv/nothing.tar.gz`),
    /refused the download \(404\): NoSuchKey/,
  );
});

test("only http(s) URLs to somewhere that is not the node's own metadata", async () => {
  await assert.rejects(() => uploadArchive(dataRoot, SERVER, "world.tar.gz", "ftp://x/y"), /must be http/);
  await assert.rejects(() => uploadArchive(dataRoot, SERVER, "world.tar.gz", "http://169.254.169.254/latest"), /link-local/);
  await assert.rejects(() => uploadArchive(dataRoot, SERVER, "../etc/passwd.tar.gz", `${base}/x`), /not a valid archive name/);
  await assert.rejects(() => uploadArchive(dataRoot, SERVER, "nothere.tar.gz", `${base}/x`), /no such archive/);
});
