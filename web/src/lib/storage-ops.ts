import "server-only";
import type { User } from "@prisma/client";
import { asPlatformError, PlatformError } from "@/domain/errors";
import {
  archiveKey,
  bucketUrl,
  objectUrl,
  presignUrl,
  signRequest,
  type StorageTarget,
} from "@/domain/storage/s3";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OpResult } from "./server-ops";

/* Off-site backup storage: one S3-compatible bucket for the workspace.

   The panel is the only thing that ever holds the keys. It keeps them
   encrypted at rest — the same AES-256-GCM as a node token — and uses
   them for two things: to sign short-lived URLs that let a node PUT or
   GET one object, and to make the small requests it makes itself, a
   probe and a delete. The bytes of an archive go from the node to the
   bucket and back; they never pass through here.

   Written once, never shown back: the settings page shows the endpoint,
   the bucket and a mask of the key id, and that is all a browser ever
   sees again. */

export interface StorageInput {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  scheduledOffsite: boolean;
}

/** How long a signed URL lives: long enough for a large archive, and no longer. */
const UPLOAD_URL_TTL_S = 60 * 60;
const DOWNLOAD_URL_TTL_S = 60 * 60;
const PROBE_TIMEOUT_MS = 15_000;

function mayManage(actor: User): boolean {
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

async function record(actor: User, action: string, target: string, tone: "INFO" | "WARNING" | "DANGER" | "SUCCESS") {
  await db.activityEvent.create({ data: { actor: actor.name, action, target, tone, userId: actor.id } });
}

/** The bucket and its keys, decrypted, for signing. Null when none is configured. */
export async function offsiteTarget(): Promise<(StorageTarget & { prefix: string; scheduledOffsite: boolean }) | null> {
  const row = await db.backupStorage.findUnique({ where: { id: "s3" } });
  if (!row) return null;
  return {
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    pathStyle: row.pathStyle,
    accessKeyId: row.accessKeyId,
    secretAccessKey: decryptSecret(row.secretAccessKey),
    prefix: row.prefix,
    scheduledOffsite: row.scheduledOffsite,
  };
}

/* ── What a node is handed ──────────────────────────────────────── */

export function uploadUrl(target: StorageTarget, key: string): string {
  return presignUrl(target, "PUT", key, { expiresS: UPLOAD_URL_TTL_S });
}

export function downloadUrl(target: StorageTarget, key: string): string {
  return presignUrl(target, "GET", key, { expiresS: DOWNLOAD_URL_TTL_S });
}

export { archiveKey };

/* ── What the panel does itself ─────────────────────────────────── */

async function s3Fetch(target: StorageTarget, method: string, url: URL, body?: string): Promise<Response> {
  const signed = signRequest(target, method, url, { body });
  try {
    return await fetch(signed.url, {
      method,
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    throw new PlatformError("RUNTIME_UNREACHABLE", `${url.host} ${reason}.`, { cause });
  }
}

/* S3 explains a refusal in a short XML document; the code in it is the
   part worth repeating to a person configuring a bucket. */
async function explain(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).replace(/\s+/g, " ");
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
  return `${res.status}${code ? ` ${code}` : ""}${message ? ` — ${message}` : ""}`;
}

/** Removes one object. A missing object is not a failure: the point was for it to be gone. */
export async function deleteObject(target: StorageTarget, key: string): Promise<void> {
  const res = await s3Fetch(target, "DELETE", objectUrl(target, key));
  if (res.ok || res.status === 404) return;
  throw new PlatformError("RUNTIME_REJECTED", `The store refused to delete the archive: ${await explain(res)}.`);
}

/* Proves the keys work for what they will be used for: a PUT of a tiny
   object under the prefix, and its DELETE. A HEAD on the bucket proves
   less — a key that can list cannot always write. */
async function probe(target: StorageTarget & { prefix: string }): Promise<void> {
  const key = archiveKey(target.prefix, ".geeboard", `probe-${Date.now()}.txt`);
  const put = await s3Fetch(target, "PUT", objectUrl(target, key), "geeboard probe");
  if (!put.ok) throw new PlatformError("RUNTIME_REJECTED", `The bucket refused a test upload: ${await explain(put)}.`);
  await deleteObject(target, key);
}

/* ── Configuring ────────────────────────────────────────────────── */

function validate(input: StorageInput): string | null {
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint.trim());
  } catch {
    return "The endpoint has to be a URL, like https://s3.eu-west-1.amazonaws.com or http://minio:9000.";
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return "The endpoint has to be http or https.";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket.trim())) return "That is not a bucket name.";
  if (!/^[a-z0-9-]{1,32}$/.test(input.region.trim())) return "A region is a short lowercase name, like us-east-1.";
  if (!input.accessKeyId.trim() || !input.secretAccessKey) return "Both keys are needed.";
  if (input.prefix.includes("..") || /[^A-Za-z0-9/_.-]/.test(input.prefix)) return "The prefix may hold letters, digits, dots, dashes, underscores and slashes.";
  return null;
}

export async function configureStorageOp(actor: User, input: StorageInput): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can configure backup storage." };
  const problem = validate(input);
  if (problem) return { ok: false, title: "Check the form", body: problem };

  const target = {
    endpoint: input.endpoint.trim().replace(/\/+$/, ""),
    region: input.region.trim(),
    bucket: input.bucket.trim(),
    prefix: input.prefix.trim().replace(/^\/+|\/+$/g, ""),
    pathStyle: input.pathStyle,
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKey: input.secretAccessKey,
  };

  /* Nothing is saved that did not just work. A bucket that refuses the
     probe is refused here, with the store's own reason, rather than
     stored and found out about at three in the morning. */
  try {
    await probe(target);
  } catch (error) {
    return { ok: false, title: "The bucket did not accept a test upload", body: asPlatformError(error).message };
  }

  const data = {
    endpoint: target.endpoint,
    region: target.region,
    bucket: target.bucket,
    prefix: target.prefix,
    pathStyle: target.pathStyle,
    accessKeyId: target.accessKeyId,
    secretAccessKey: encryptSecret(target.secretAccessKey),
    scheduledOffsite: input.scheduledOffsite,
    checkedAt: new Date(),
    checkError: null,
    configuredById: actor.id,
  };
  await db.backupStorage.upsert({ where: { id: "s3" }, create: { id: "s3", ...data }, update: data });
  await record(actor, "storage.configured", `${target.bucket} at ${target.endpoint}`, "INFO");

  return {
    ok: true,
    tone: "success",
    title: "Off-site storage is set",
    body: `${target.bucket} accepted a test upload. The keys are stored encrypted and will not be shown again.`,
  };
}

export async function setScheduledOffsiteOp(actor: User, scheduledOffsite: boolean): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can change backup storage." };
  const row = await db.backupStorage.findUnique({ where: { id: "s3" } });
  if (!row) return { ok: false, title: "No storage", body: "Configure a bucket first." };
  await db.backupStorage.update({ where: { id: "s3" }, data: { scheduledOffsite } });
  await record(actor, "storage.scheduled", scheduledOffsite ? "scheduled backups go off-site" : "scheduled backups stay on the node", "INFO");
  return {
    ok: true,
    tone: "success",
    title: "Saved",
    body: scheduledOffsite ? "Scheduled backups will be sent to the bucket." : "Scheduled backups will stay on their node.",
  };
}

export async function checkStorageOp(actor: User): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can check backup storage." };
  const target = await offsiteTarget();
  if (!target) return { ok: false, title: "No storage", body: "Configure a bucket first." };
  try {
    await probe(target);
    await db.backupStorage.update({ where: { id: "s3" }, data: { checkedAt: new Date(), checkError: null } });
    return { ok: true, tone: "success", title: "The bucket answers", body: `${target.bucket} accepted and removed a test object.` };
  } catch (error) {
    const message = asPlatformError(error).message;
    await db.backupStorage.update({ where: { id: "s3" }, data: { checkedAt: new Date(), checkError: message } });
    return { ok: false, title: "The bucket did not answer", body: message };
  }
}

/* Forgetting the bucket. The archives in it stay where they are, and
   so do their rows: a row whose bytes are somewhere the panel can no
   longer reach says so on the Backups page rather than disappearing. */
export async function removeStorageOp(actor: User): Promise<OpResult> {
  if (!mayManage(actor)) return { ok: false, title: "Not permitted", body: "Only owners and admins can remove backup storage." };
  const row = await db.backupStorage.findUnique({ where: { id: "s3" } });
  if (!row) return { ok: false, title: "No storage", body: "There is nothing to remove." };
  const offsite = await db.backup.count({ where: { store: "S3" } });
  await db.backupStorage.delete({ where: { id: "s3" } });
  await record(actor, "storage.removed", `${row.bucket} at ${row.endpoint} · ${offsite} archive${offsite === 1 ? "" : "s"} left in it`, "WARNING");
  return {
    ok: true,
    tone: "warning",
    title: "Off-site storage removed",
    body:
      offsite === 0
        ? "The keys are gone from the panel."
        : `The keys are gone from the panel. ${offsite} archive${offsite === 1 ? "" : "s"} stay in the bucket and cannot be restored from here until it is configured again.`,
  };
}

/** What the Backups page shows about the bucket — nothing secret. */
export async function storageStatus() {
  const [row, offsite] = await Promise.all([
    db.backupStorage.findUnique({ where: { id: "s3" } }),
    db.backup.aggregate({ where: { store: "S3", state: { in: ["COMPLETE", "LOCKED"] } }, _count: true, _sum: { sizeBytes: true } }),
  ]);
  if (!row) return { configured: false as const, offsiteCount: offsite._count, offsiteBytes: Number(offsite._sum.sizeBytes ?? BigInt(0)) };
  const id = row.accessKeyId;
  return {
    configured: true as const,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    prefix: row.prefix,
    pathStyle: row.pathStyle,
    accessKeyMask: id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "•••",
    scheduledOffsite: row.scheduledOffsite,
    checkedAt: row.checkedAt,
    checkError: row.checkError,
    offsiteCount: offsite._count,
    offsiteBytes: Number(offsite._sum.sizeBytes ?? BigInt(0)),
  };
}

export { bucketUrl };
