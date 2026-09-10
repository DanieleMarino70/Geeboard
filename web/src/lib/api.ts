import "server-only";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import {
  can as roleCan,
  permissionsForScopes,
  type Permission,
} from "@/domain/access/permissions";
import { PlatformError, asPlatformError, type ErrorCode } from "@/domain/errors";
import { getCurrentUser } from "./auth";
import { db } from "./db";

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

/** Everything a client is ever told about a failure. */
export function fail(error: unknown): NextResponse {
  const platform = asPlatformError(error);
  if (platform.code === "INTERNAL") {
    // The cause is for the log, and only for the log.
    console.error("api:", platform.cause ?? platform);
  }
  return NextResponse.json(platform.toBody(), { status: platform.status });
}

export function ok(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function refuse(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new PlatformError(code, message, { details });
}

/* ── Identifying the caller ───────────────────────────────────────── */

const KEY_PREFIX = "gbk_live_";

/* The stored prefix is a mask, not a lookup key — it is what the UI
   shows. Rebuilding it from the presented secret narrows the search to a
   handful of rows; the bcrypt comparison is what actually decides. */
function maskFor(secret: string): string | null {
  if (!secret.startsWith(KEY_PREFIX)) return null;
  const body = secret.slice(KEY_PREFIX.length);
  if (body.length < 8) return null;
  return `${KEY_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

async function principalFromKey(secret: string): Promise<Principal | null> {
  const mask = maskFor(secret);
  if (!mask) return null;

  const candidates = await db.apiKey.findMany({
    where: { prefix: mask, revokedAt: null },
    include: { user: true },
  });

  for (const key of candidates) {
    if (!(await bcrypt.compare(secret, key.hash))) continue;
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
export async function authenticate(req: Request): Promise<Principal> {
  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, value] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !value) {
      refuse("UNAUTHENTICATED", "Authorization must be a bearer token.");
    }
    const principal = await principalFromKey(value);
    if (!principal) refuse("UNAUTHENTICATED", "That key is not valid.");
    return principal;
  }

  const user = await getCurrentUser();
  if (!user) refuse("UNAUTHENTICATED", "Sign in or present an API key.");
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
  const key = principal.keyId ?? `user:${principal.id}`;
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
export async function begin(req: Request, limit?: number): Promise<Principal> {
  const principal = await authenticate(req);
  rateLimit(principal, limit);
  return principal;
}
