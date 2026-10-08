import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import {
  can as roleCan,
  permissionsForScopes,
  type Permission,
} from "@/domain/access/permissions";
import { accountGate } from "@/domain/access/account";
import { cookieMutationProblem } from "@/domain/access/origin";
import { PlatformError, asPlatformError, type ErrorCode } from "@/domain/errors";
import { attempt, exhausted } from "./attempts";
import { getCurrentUser } from "./auth";
import { db } from "./db";
import { acceptRequestId, enterRequest, logger } from "./log";
import { requestSource } from "./request-source";

/* The HTTP API's front door.

   Two things arrive here: a browser with a session cookie, and a program
   with an API key. They are the same principal as far as permissions go
   — a key never grants its owner anything its owner does not already
   have — but a key can hold *less*, which is the whole reason to issue
   one. Both checks have to pass. */

export interface Principal {
  id: string;
  name: string;
  role: Role;
  /** How the request identified itself. */
  via: "session" | "api-key";
  /** Null for a session, which is not scope-limited. */
  keyId: string | null;
  scopes: Set<Permission> | null;
}

export { fail, ok } from "./api-response";

function refuse(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new PlatformError(code, message, { details });
}

/* ── Identifying the caller ───────────────────────────────────────── */

const KEY_PREFIX = "gbk_live_";
const FAILED_KEYS_PER_MINUTE = 30;

/* The stored prefix is a mask, not a lookup key — it is what the UI
   shows. Rebuilding it from the presented secret narrows the search to a
   handful of rows; the bcrypt comparison is what actually decides. */
function maskFor(secret: string): string | null {
  if (!secret.startsWith(KEY_PREFIX)) return null;
  const body = secret.slice(KEY_PREFIX.length);
  if (body.length < 8) return null;
  return `${KEY_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

/* A key that has been proved is remembered, briefly, so that the proof is not paid again.

   bcrypt is 73 ms of event loop for a key at cost 10 and it does not yield inside that, and a program that polls (a 202 is
   followed by polling, which is how this API is used) sends a key a hundred times a minute: five of them took most of a
   core and made the panel's own pages wait. The secret is held as its SHA-256, with the key's id and the hash it was proved
   against, for five minutes. The row is still read on every request, with `revokedAt: null`, so a revoked key is refused at
   once and a key whose stored hash changed is proved again; only the bcrypt compare is skipped. */
const PROVED_FOR_MS = 5 * 60_000;
const PROVED_KEPT = 512;
const proved = new Map<string, { digest: Buffer; rowHash: string; until: number }>();
const digestOf = (secret: string) => createHash("sha256").update(secret).digest();

/* A secret that was proved wrong is remembered too, for a minute: the mask a key shows on the API keys page (its first four and last four characters) is
   enough to find its row, and a loop of requests carrying that mask and a wrong middle paid 73 ms of event loop for every one of them, from anybody who had
   ever seen a screenshot of a key (the audit of 0.9.5). The same wrong secret against the same row is answered from here; a different one is counted against
   its source in `authenticate`, which refuses a source that has failed thirty times in a minute before it reads a key at all. */
const REJECTED_FOR_MS = 60_000;
const REJECTED_KEPT = 512;
const rejected = new Map<string, number>();

async function secretMatches(secret: string, key: { id: string; hash: string }): Promise<boolean> {
  const now = Date.now();
  const digest = digestOf(secret);
  const known = proved.get(key.id);
  if (known && known.until > now && known.rowHash === key.hash && timingSafeEqual(known.digest, digest)) return true;
  const wrongKey = `${key.id}:${key.hash.slice(-12)}:${digest.toString("hex")}`;
  if ((rejected.get(wrongKey) ?? 0) > now) return false;
  if (!(await bcrypt.compare(secret, key.hash))) {
    if (rejected.size >= REJECTED_KEPT) {
      for (const [id, until] of rejected) if (until <= now) rejected.delete(id);
      if (rejected.size >= REJECTED_KEPT) rejected.delete(rejected.keys().next().value!);
    }
    rejected.set(wrongKey, now + REJECTED_FOR_MS);
    return false;
  }
  if (proved.size >= PROVED_KEPT) {
    for (const [id, entry] of proved) if (entry.until <= now) proved.delete(id);
    if (proved.size >= PROVED_KEPT) proved.delete(proved.keys().next().value!);
  }
  proved.set(key.id, { digest, rowHash: key.hash, until: now + PROVED_FOR_MS });
  return true;
}

async function principalFromKey(secret: string): Promise<Principal | null> {
  const mask = maskFor(secret);
  if (!mask) return null;

  const candidates = await db.apiKey.findMany({
    where: { prefix: mask, revokedAt: null },
    include: { user: true },
  });

  for (const key of candidates) {
    if (!(await secretMatches(secret, key))) continue;
    if (key.expiresAt && key.expiresAt < new Date()) {
      refuse("UNAUTHENTICATED", "That key has expired.");
    }

    // Best effort: a failed bookkeeping write must not fail the request.
    void db.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return {
      id: key.user.id,
      name: key.user.name,
      role: key.user.role,
      via: "api-key",
      keyId: key.id,
      scopes: permissionsForScopes(key.scopes),
    };
  }
  return null;
}

/** The caller, or a refusal. Never returns an anonymous principal. */
export async function authenticate(req: Request, options: { rawBody?: boolean } = {}): Promise<Principal> {
  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, value] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !value) {
      refuse("UNAUTHENTICATED", "Authorization must be a bearer token.");
    }
    /* A source that has been refused thirty times in a minute is refused without a key being read: the bcrypt compare is what a stranger can make this
       process do for the price of a request, and it does not yield (the same rule as /nodes/heartbeat). */
    const source = requestSource(req.headers);
    if (exhausted(`apikey-fail:${source}`, FAILED_KEYS_PER_MINUTE)) {
      throw new PlatformError("RATE_LIMITED", "Too many keys were refused from this address. Wait a minute.");
    }
    const principal = await principalFromKey(value);
    if (!principal) {
      attempt(`apikey-fail:${source}`, FAILED_KEYS_PER_MINUTE, 60_000);
      refuse("UNAUTHENTICATED", "That key is not valid.");
    }
    return principal;
  }

  const user = await getCurrentUser();
  if (!user) refuse("UNAUTHENTICATED", "Sign in or present an API key.");
  // A cookie alone is what a hostile page can cause: see cookieMutationProblem.
  const problem = cookieMutationProblem(req, options);
  if (problem) refuse(problem.code, problem.message);
  /* The same door the pages close: an owner or admin who has not set up
     two-factor reaches their account page and nothing else, and the API
     is not a way around that. */
  const gate = accountGate(user);
  if (gate === "password") refuse("FORBIDDEN", "Replace this account's temporary password first, from its account page.");
  if (gate === "two-factor") refuse("FORBIDDEN", "Set up two-factor sign-in for this account first.");
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    via: "session",
    keyId: null,
    scopes: null,
  };
}

/* Both halves of the answer: what the role allows, and what the key was
   issued for. A key can only ever narrow. */
export function allows(principal: Principal, permission: Permission, ownerId?: string | null) {
  if (principal.scopes && !principal.scopes.has(permission)) return false;
  return roleCan(principal, permission, ownerId);
}

export function mustAllow(
  principal: Principal,
  permission: Permission,
  ownerId?: string | null,
): void {
  if (allows(principal, permission, ownerId)) return;

  /* Saying which of the two failed is worth the small amount it gives
     away: "your key cannot do this" and "your account cannot do this"
     need completely different fixes. */
  if (principal.scopes && !principal.scopes.has(permission)) {
    refuse("INSUFFICIENT_SCOPE", "This API key was not issued for that.", { permission });
  }
  refuse("FORBIDDEN", "You do not have permission to do that.", { permission });
}

/* ── Rate limiting ────────────────────────────────────────────────
   A fixed window per principal, held in this process.

   Deliberately modest about what it is: behind more than one instance
   each has its own counter, so this bounds a runaway script rather than
   a determined attacker. Anything stronger belongs in front of the app,
   where it can see every instance. */
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(principal: Principal, limit = 120): void {
  /* One bucket per caller *and per budget*: a heavy route's ten a
     minute must not be spent by a hundred cheap reads before it, or a
     client that listed servers a few times could not then create one. */
  const key = `${principal.keyId ?? `user:${principal.id}`}:${limit}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Sweep expired buckets so a long-running process does not grow one
    // entry per key that ever called.
    if (buckets.size > 4096) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return;
  }

  bucket.count++;
  if (bucket.count > limit) {
    throw new PlatformError("RATE_LIMITED", "Too many requests. Slow down.", {
      details: { retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) },
    });
  }
}

/** Authenticate and rate-limit in one step, which every route needs. */
export async function begin(req: Request, limit?: number, options: { rawBody?: boolean } = {}): Promise<Principal> {
  /* The id src/proxy.ts gave this request, held for the rest of it: what
     the operation logs, and what it sends on to a node, carry it. */
  enterRequest(acceptRequestId(req.headers.get("x-request-id")));
  const started = Date.now();
  try {
    const principal = await authenticate(req, options);
    rateLimit(principal, limit);
    logger.info("api request", {
      method: req.method,
      path: new URL(req.url).pathname,
      principal: principal.keyId ? `key:${principal.keyId}` : `user:${principal.id}`,
    });
    return principal;
  } catch (error) {
    // Who was refused, and why, without the credential they presented.
    logger.warn("api request refused", {
      method: req.method,
      path: new URL(req.url).pathname,
      code: asPlatformError(error).code,
      ms: Date.now() - started,
    });
    throw error;
  }
}
