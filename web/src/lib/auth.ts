import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";

const COOKIE = "gb_session";
const MAX_AGE_S = 60 * 60 * 24 * 14; // two weeks

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(s);
}

/* The cookie carries a signed pointer to a Session row, never user
   data — revoking a session is a delete, not a wait for expiry. */
async function sign(sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

async function read(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const session = await db.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + MAX_AGE_S * 1000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });

  const jar = await cookies();
  jar.set(COOKIE, await sign(session.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const sid = await read(token);
    if (sid) await db.session.deleteMany({ where: { id: sid } });
  }
  jar.delete(COOKIE);
}

/* Deduped per request, so a page and its components can all ask for
   the current user without repeating the query. */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const sid = await read(token);
  if (!sid) return null;

  const session = await db.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Hash even when the user is missing, so a wrong address and a wrong
  // password take the same time to answer.
  const hash = user?.passwordHash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu";
  const ok = await bcrypt.compare(password, hash);
  return ok && user ? user : null;
}
