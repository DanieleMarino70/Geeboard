import { createHash, createHmac } from "node:crypto";

/* AWS Signature Version 4, for an S3-compatible store.

   Written by hand rather than pulled in: the SDK is tens of megabytes
   and a moving target, and what Geeboard needs of it is one algorithm —
   HMAC-SHA256 over a canonical request — to make a URL that lets a node
   PUT or GET one object for a few minutes, and to sign the handful of
   small requests the panel makes itself (a probe, a delete). It is
   checked against Amazon's own published examples in
   test/s3-sign.test.ts, and against MinIO for real.

   Nothing here does I/O. It turns a description of a request into a
   URL or a set of headers, and the caller decides who fetches it. */

export interface StorageTarget {
  /** Scheme and host, e.g. https://s3.eu-west-1.amazonaws.com or http://localhost:9000. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /* Path-style puts the bucket in the path (`/bucket/key`), which is
     what MinIO and most self-hosted stores expect; virtual-hosted puts
     it in the host (`bucket.host`), which is Amazon's default. */
  pathStyle: boolean;
}

const SERVICE = "s3";
const UNSIGNED = "UNSIGNED-PAYLOAD";

/* RFC 3986 encoding as AWS wants it: everything but unreserved
   characters, including the ones encodeURIComponent leaves alone. A
   key's slashes stay slashes in a path. */
export function awsEncode(text: string, keepSlash = false): string {
  const encoded = encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** YYYYMMDDTHHMMSSZ and its date half, from a moment. */
export function amzDate(at: Date): { stamp: string; day: string } {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { stamp, day: stamp.slice(0, 8) };
}

function signingKey(secret: string, day: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

/** Where an object lives, as a URL, in the addressing style the store wants. */
export function objectUrl(target: StorageTarget, key: string): URL {
  const base = new URL(target.endpoint);
  const path = awsEncode(key, true);
  if (target.pathStyle) {
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${target.bucket}/${path}`;
  } else {
    base.host = `${target.bucket}.${base.host}`;
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/${path}`;
  }
  return base;
}

/** The bucket itself, for a request that has no key. */
export function bucketUrl(target: StorageTarget): URL {
  const base = new URL(target.endpoint);
  if (target.pathStyle) base.pathname = `${base.pathname.replace(/\/+$/, "")}/${target.bucket}/`;
  else {
    base.host = `${target.bucket}.${base.host}`;
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
  }
  return base;
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/* The host as it appears in the Host header: the port only when it is
   not the scheme's default, which is how a client sends it. */
function hostHeader(url: URL): string {
  return url.host;
}

/* A URL that grants one request on one object until it expires — what
   the panel hands a node so the node can move the bytes without ever
   holding the credentials. The signature covers the method, the path,
   the query (expiry included) and the host; the payload is unsigned,
   which is the documented form for presigned S3 uploads. */
export function presignUrl(
  target: StorageTarget,
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  key: string,
  options: { expiresS?: number; at?: Date } = {},
): string {
  const url = objectUrl(target, key);
  const { stamp, day } = amzDate(options.at ?? new Date());
  const scope = `${day}/${target.region}/${SERVICE}/aws4_request`;

  const params = new URLSearchParams();
  params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  params.set("X-Amz-Credential", `${target.accessKeyId}/${scope}`);
  params.set("X-Amz-Date", stamp);
  params.set("X-Amz-Expires", String(options.expiresS ?? 900));
  params.set("X-Amz-SignedHeaders", "host");

  const canonical = [
    method,
    url.pathname,
    canonicalQuery(params),
    `host:${hostHeader(url)}\n`,
    "host",
    UNSIGNED,
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(target.secretAccessKey, day, target.region))
    .update(toSign)
    .digest("hex");

  params.set("X-Amz-Signature", signature);
  url.search = canonicalQuery(params);
  return url.toString();
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/* A request the panel makes itself — a HEAD on the bucket to see that
   the keys work, a DELETE of an object nobody wants — with the
   signature in the Authorization header. Bodies are small or absent,
   so the payload hash is real, not UNSIGNED. */
export function signRequest(
  target: StorageTarget,
  method: string,
  url: URL,
  options: { body?: string | Uint8Array; headers?: Record<string, string>; at?: Date } = {},
): SignedRequest {
  const { stamp, day } = amzDate(options.at ?? new Date());
  const scope = `${day}/${target.region}/${SERVICE}/aws4_request`;
  const payloadHash = sha256Hex(options.body ?? "");

  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: hostHeader(url),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signed = names.join(";");

  const canonical = [
    method,
    url.pathname,
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signed,
    payloadHash,
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(target.secretAccessKey, day, target.region))
    .update(toSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signed}, Signature=${signature}`;

  // Host goes on the wire by itself; fetch refuses it as a header.
  const { host: _host, ...rest } = headers;
  void _host;
  return { url: url.toString(), headers: { ...rest, authorization } };
}

/* The object key for a server's archive. One prefix per server, so a
   bucket listing reads like the panel's own layout and a server's
   objects can be found without the panel. */
export function archiveKey(prefix: string, serverId: string, artifact: string): string {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  return `${clean ? `${clean}/` : ""}${serverId}/${artifact}`;
}
