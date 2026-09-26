import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { accountGate } from "@/domain/access/account";
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
  /* No request, no cookie jar — a script calling a route handler
     directly. That is the same answer as no cookie: nobody. */
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    return null;
  }
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const sid = await read(token);
  if (!sid) return null;
  return userForSession(sid);
});

/* The account behind a session, or null once the session has ended or
   expired. Apart from getCurrentUser because a stream asks it again long
   after its request began, from a timer, where reading the cookie jar is
   not something to rely on: the session id is read once, at the start,
   and this is asked with it. */
export async function userForSession(sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

/* The signed-in person, or a redirect to sign in.

   An owner or admin who has not set up two-factor is signed in and not
   let anywhere but their account page: every other page sends them
   there until it is done. The account page and its actions ask with
   `allowUnenrolled`, which is the one door left open. */
export async function requireUser(options: { allowUnenrolled?: boolean } = {}) {
  const user = await getCurrentUser();
  /* Loaded here rather than at the top: next/navigation cannot be
     imported outside Next, and the API front door imports this module
     for getCurrentUser alone — which is what lets verify:api call the
     route handlers with no Next server running. */
  const { redirect } = await import("next/navigation");
  if (!user) {
    redirect("/sign-in");
    throw new Error("redirected"); // redirect never returns; this is for the type checker
  }
  /* First the password, then two-factor, in that order — see accountGate.
     One door either way: the account page, which says which of the two
     is missing and lets nothing else be done until it is. */
  const gate = accountGate(user);
  if (!options.allowUnenrolled && gate) {
    redirect(gate === "password" ? "/account?password=required" : "/account?enrol=required");
  }
  return user;
}

/** The id of the session this request is using, to keep it when ending the others. */
export async function currentSessionId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  return token ? read(token) : null;
}

/* ── Between the password and the code ─────────────────────────────

   A correct password on a two-factor account earns no session yet. It
   earns a short-lived signed cookie naming the account, which is all
   the code page needs and all a stolen cookie would give: the right to
   guess at a six-digit code, five times. */
const MFA_COOKIE = "gb_mfa";
const MFA_MAX_AGE_S = 5 * 60;

export async function beginSecondFactor(userId: string) {
  const token = await new SignJWT({ mfa: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MFA_MAX_AGE_S}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(MFA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/sign-in",
    maxAge: MFA_MAX_AGE_S,
  });
}

/** The account waiting on its code, or null when there is none or it took too long. */
export async function pendingSecondFactor(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.mfa === "string" ? payload.mfa : null;
  } catch {
    return null;
  }
}

export async function endSecondFactor() {
  const jar = await cookies();
  jar.delete({ name: MFA_COOKIE, path: "/sign-in" });
}

export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Hash even when the user is missing, so a wrong address and a wrong
  // password take the same time to answer.
  const hash = user?.passwordHash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu";
  const ok = await bcrypt.compare(password, hash);
  return ok && user ? user : null;
}
