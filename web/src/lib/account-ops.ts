import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { AccountTokenPurpose, EventTone, Role, User } from "@prisma/client";
import {
  RESET_LINK_TTL_MS,
  SETUP_LINK_TTL_MS,
  initialsOf,
  looksLikeTotp,
  normaliseRecoveryCode,
  passwordProblem,
  temporaryPasswordExpired,
  requiresTwoFactor,
} from "@/domain/access/account";
import { base32Encode, otpauthUri, verifyTotp } from "@/domain/access/totp";
import { qrRows } from "./qr";
import { attempt, clearAttempts } from "./attempts";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";
import type { OpResult } from "./server-ops";
import { isSystemAccount } from "./system-user";

/* Accounts: made from the panel, given a password by their owner, and
   put behind a second factor.

   The panel sends no email. So a new account, or a reset, is a one-time
   link shown once to the admin who asked for it, to hand over however
   they hand things over. The link is the credential: 32 random bytes,
   kept only as a SHA-256, spent atomically the moment it is used, and
   dead after its time. It is worth exactly what a password-reset email
   would be worth — and it never sits in a mailbox.

   Two-factor is TOTP — the six digits every authenticator app makes —
   with recovery codes for a lost phone. The secret is encrypted at rest
   like a node token; the codes are hashed like an API key. Both are
   shown once. */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const BCRYPT_COST = 12;

type Ok<T> = Extract<OpResult, { ok: true }> & T;
type Refused = Extract<OpResult, { ok: false }>;

function refuse(title: string, body: string): Refused {
  return { ok: false, title, body };
}

async function record(actor: User, action: string, target: string, tone: EventTone, userId = actor.id) {
  await db.activityEvent.create({ data: { actor: actor.name, action, target, tone, userId } });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── One-time links ─────────────────────────────────────────────── */

/* `baseUrl` is the panel's own address, worked out by the caller from
   the request (see panel-url.ts): an operation must not read request
   headers itself, or it cannot run from a script. */
async function mintLink(userId: string, purpose: AccountTokenPurpose, createdById: string, baseUrl: string) {
  const token = `gbt_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + (purpose === "SETUP" ? SETUP_LINK_TTL_MS : RESET_LINK_TTL_MS));

  /* One live link per account. An earlier one that was never used is
     ended here rather than left to expire: a reset asked for twice must
     not leave the first link working. */
  await db.accountToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.accountToken.create({
    data: { userId, purpose, hash: sha256(token), expiresAt, createdById },
  });

  return { link: `${baseUrl.replace(/\/+$/, "")}/setup/${token}`, expiresAt };
}

/** What a setup link is for, without spending it — for the page that shows the form. */
export async function previewLink(token: string) {
  const found = await db.accountToken.findUnique({
    where: { hash: sha256(token) },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!found || found.usedAt || found.expiresAt < new Date()) return null;
  return { purpose: found.purpose, name: found.user.name, email: found.user.email };
}

/* ── Members, from the panel ────────────────────────────────────── */

function mayManage(actor: User): boolean {
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

export async function createMemberOp(
  actor: User,
  input: { name: string; email: string; role: Role },
  baseUrl: string,
): Promise<OpResult | Ok<{ link: string; expiresAt: Date }>> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can add members.");
  // The same line admins cannot cross when changing roles.
  if (actor.role === "ADMIN" && input.role === "OWNER") {
    return refuse("Not permitted", "Only an owner can make another owner.");
  }

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 60) return refuse("Check the form", "A name is between 2 and 60 characters.");
  if (!EMAIL.test(email) || email.length > 120) return refuse("Check the form", "That is not an email address.");
  if (await db.user.findUnique({ where: { email } })) {
    return refuse("Already a member", `${email} already has an account.`);
  }

  /* A password nobody knows, so the row is complete and the account
     cannot be signed into until its owner has chosen one through the
     link. `passwordSetAt` stays null until then, and the Members page
     says so. */
  const user = await db.user.create({
    data: {
      name,
      email,
      role: input.role,
      initials: initialsOf(name),
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_COST),
    },
  });
  const { link, expiresAt } = await mintLink(user.id, "SETUP", actor.id, baseUrl);
  await record(actor, "member.created", `${name} <${email}> as ${input.role.toLowerCase()}`, "INFO");

  return {
    ok: true,
    tone: "success",
    title: `${name} added`,
    body: "Hand them the setup link — it is shown once and works for seven days.",
    link,
    expiresAt,
  };
}

export async function issueResetLinkOp(
  actor: User,
  memberId: string,
  baseUrl: string,
): Promise<OpResult | Ok<{ link: string; expiresAt: Date }>> {
  if (!mayManage(actor)) return refuse("Not permitted", "Only owners and admins can reset a password.");

  const member = await db.user.findUnique({ where: { id: memberId } });
  if (!member) return refuse("Cannot reset", "That account no longer exists.");
  if (isSystemAccount(member)) return refuse("That is a system account", "It has no password to reset.");
  if (member.id === actor.id) return refuse("Change it instead", "Your own password is changed from your account page.");
  if (actor.role === "ADMIN" && member.role === "OWNER") {
    return refuse("Not permitted", "Only an owner can reset another owner's password.");
  }

  const { link, expiresAt } = await mintLink(member.id, "RESET", actor.id, baseUrl);
  /* Every session ends now, not when the link is used: the reason for a
     reset is usually that the old password is in the wrong hands, and
     those hands may be signed in. */
  const { count } = await db.session.deleteMany({ where: { userId: member.id } });
  await record(actor, "member.password.reset", `${member.name} · ${count} session${count === 1 ? "" : "s"} ended`, "WARNING", member.id);

  return {
    ok: true,
    tone: "warning",
    title: `Reset link for ${member.name}`,
    body: `Their ${count === 1 ? "session was" : `${count} sessions were`} ended. The link is shown once and works for a day.`,
    link,
    expiresAt,
  };
}

/* ── Setting a password through a link ─────────────────────────── */

export async function completeSetupOp(token: string, password: string): Promise<OpResult> {
  const hash = sha256(token);
  // A link is a credential; guessing at them is bounded like a password.
  if (!attempt(`link:${hash.slice(0, 16)}`, 10, 15 * 60_000)) {
    return refuse("Too many attempts", "Wait a few minutes and try again.");
  }
  const problem = passwordProblem(password);
  if (problem) return refuse("Check the password", problem);

  /* Claimed in one statement, so two submissions racing on one link
     cannot both succeed: the second finds it already used. */
  const claimed = await db.accountToken.updateMany({
    where: { hash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return refuse("This link no longer works", "It was used, it expired, or it was replaced by a newer one. Ask an admin for another.");
  }

  const found = await db.accountToken.findUnique({ where: { hash }, include: { user: true } });
  if (!found) return refuse("This link no longer works", "Ask an admin for another.");

  /* The account starts over from this password: two-factor comes off
     with it, since a reset is also how somebody whose phone and recovery
     codes are both gone gets back in. An admin handing out a reset is
     therefore removing a second factor, and the audit log says so. An
     owner or admin is made to enrol again before they get past their
     account page. */
  await db.user.update({
    where: { id: found.userId },
    data: {
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      passwordSetAt: new Date(),
      twoFactor: false,
      totpSecret: null,
      totpLastStep: null,
    },
  });
  await db.recoveryCode.deleteMany({ where: { userId: found.userId } });
  // Whoever was signed in as this account with the old password is not any more.
  await db.session.deleteMany({ where: { userId: found.userId } });
  await record(
    found.user,
    found.purpose === "SETUP" ? "account.password.set" : "account.password.reset.completed",
    found.user.twoFactor ? `${found.user.email} · two-factor removed` : found.user.email,
    found.user.twoFactor ? "WARNING" : "INFO",
  );
  clearAttempts(`link:${hash.slice(0, 16)}`);

  return { ok: true, tone: "success", title: "Password set", body: "Sign in with it now." };
}

/* ── The signed-in person's own account ─────────────────────────── */

export async function changePasswordOp(
  user: User,
  current: string,
  next: string,
  keepSessionId: string | null,
): Promise<OpResult> {
  if (!attempt(`password:${user.id}`, 10, 15 * 60_000)) {
    return refuse("Too many attempts", "Wait a few minutes and try again.");
  }
  if (!(await bcrypt.compare(current, user.passwordHash))) {
    return refuse("Current password is wrong", "Type the password you sign in with today.");
  }
  /* A temporary password that has run out does not get to be exchanged
     for a real one by a session opened while it still worked: whoever
     holds it after a day is not assumed to be the person it was made for. */
  if (temporaryPasswordExpired(user)) {
    return refuse(
      "The temporary password has expired",
      "It was good for a day. On the machine the panel runs on, `npm run admin:recover` makes a new one.",
    );
  }
  const problem = passwordProblem(next);
  if (problem) return refuse("Check the new password", problem);
  if (current === next) return refuse("Nothing changed", "The new password is the same as the old one.");

  const wasTemporary = user.passwordSetAt === null;
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(next, BCRYPT_COST),
      passwordSetAt: new Date(),
      temporaryPasswordExpiresAt: null,
    },
  });
  if (wasTemporary) await record(user, "account.temporary-password.replaced", "chose a password of their own", "SUCCESS");
  /* Every other device is signed out; this one keeps its session, since
     the person changing the password is plainly the one holding it. */
  const { count } = await db.session.deleteMany({
    where: { userId: user.id, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
  await record(user, "account.password.changed", `${count} other session${count === 1 ? "" : "s"} ended`, "INFO");
  clearAttempts(`password:${user.id}`);

  return {
    ok: true,
    tone: "success",
    title: "Password changed",
    body: count > 0 ? `${count} other ${count === 1 ? "session was" : "sessions were"} signed out.` : "No other sessions were open.",
  };
}

export async function signOutEverywhereOp(user: User, keepSessionId: string | null): Promise<OpResult> {
  const { count } = await db.session.deleteMany({
    where: { userId: user.id, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
  });
  await record(user, "account.sessions.ended", `${count} session${count === 1 ? "" : "s"}`, "WARNING");
  return {
    ok: true,
    tone: "success",
    title: "Signed out elsewhere",
    body: count === 0 ? "No other sessions were open." : `${count} other ${count === 1 ? "session" : "sessions"} ended.`,
  };
}

/* ── Two-factor ─────────────────────────────────────────────────── */

const ISSUER = "Geeboard";

/* Starts enrolment: a fresh secret, stored encrypted and not yet in
   force. The same secret is returned in the two forms an authenticator
   takes — the base32 to type, the otpauth URI to scan — and shown once. */
export async function beginTwoFactorOp(
  user: User,
): Promise<OpResult | Ok<{ secret: string; uri: string; qr: string[] }>> {
  if (user.twoFactor) return refuse("Already on", "Two-factor is already set up for this account.");
  // In order: a second factor enrolled behind a password others may have seen is not the owner's.
  if (user.passwordSetAt === null) {
    return refuse("Password first", "Replace the temporary password with one of your own, then set up two-factor.");
  }

  const secret = randomBytes(20);
  await db.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptSecret(secret.toString("base64url")), totpLastStep: null },
  });

  return {
    ok: true,
    tone: "success",
    title: "Add it to your authenticator",
    body: "Then type the code it shows to finish.",
    secret: base32Encode(secret),
    uri: otpauthUri(ISSUER, user.email, secret),
    // The same URI as a code to scan, made here: the secret goes to no other service.
    qr: qrRows(otpauthUri(ISSUER, user.email, secret)),
  };
}

function secretOf(user: Pick<User, "totpSecret">): Buffer | null {
  if (!user.totpSecret) return null;
  return Buffer.from(decryptSecret(user.totpSecret), "base64url");
}

/* Ten codes, each ten characters from an alphabet without look-alikes,
   shown as two groups of five. Kept as SHA-256: they are as random as
   an API key, so a fast hash is enough and lets a lookup be a lookup. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function makeRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    let code = "";
    for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = makeRecoveryCodes();
  await db.recoveryCode.deleteMany({ where: { userId } });
  await db.recoveryCode.createMany({
    data: codes.map((code) => ({ userId, hash: sha256(normaliseRecoveryCode(code)) })),
  });
  return codes;
}

export async function confirmTwoFactorOp(user: User, code: string): Promise<OpResult | Ok<{ codes: string[] }>> {
  if (user.twoFactor) return refuse("Already on", "Two-factor is already set up for this account.");
  const secret = secretOf(user);
  if (!secret) return refuse("Start over", "Begin the setup again to get a secret.");
  if (!attempt(`mfa:${user.id}`, 5, 5 * 60_000)) return refuse("Too many attempts", "Wait five minutes and try again.");

  const step = verifyTotp(secret, code, Date.now(), user.totpLastStep);
  if (step === null) return refuse("That code did not match", "Check the clock on your phone and try the next code.");

  await db.user.update({ where: { id: user.id }, data: { twoFactor: true, totpLastStep: step } });
  const codes = await replaceRecoveryCodes(user.id);
  await record(user, "account.twofactor.enabled", user.email, "INFO");
  clearAttempts(`mfa:${user.id}`);

  return {
    ok: true,
    tone: "success",
    title: "Two-factor is on",
    body: "Save the recovery codes somewhere safe — they are shown once.",
    codes,
  };
}

export async function regenerateRecoveryCodesOp(user: User, code: string): Promise<OpResult | Ok<{ codes: string[] }>> {
  const secret = secretOf(user);
  if (!user.twoFactor || !secret) return refuse("Not on", "Two-factor is not set up for this account.");
  if (!attempt(`mfa:${user.id}`, 5, 5 * 60_000)) return refuse("Too many attempts", "Wait five minutes and try again.");

  const step = verifyTotp(secret, code, Date.now(), user.totpLastStep);
  if (step === null) return refuse("That code did not match", "Type the current code from your authenticator.");

  await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
  const codes = await replaceRecoveryCodes(user.id);
  await record(user, "account.recovery.regenerated", user.email, "WARNING");
  clearAttempts(`mfa:${user.id}`);

  return { ok: true, tone: "success", title: "New recovery codes", body: "The old ones no longer work.", codes };
}

export async function disableTwoFactorOp(user: User, password: string, code: string): Promise<OpResult> {
  if (requiresTwoFactor(user.role)) {
    return refuse("Required for your role", "Owners and admins keep two-factor on. Regenerate the codes or set it up again on a new phone instead.");
  }
  const secret = secretOf(user);
  if (!user.twoFactor || !secret) return refuse("Not on", "Two-factor is not set up for this account.");
  if (!attempt(`mfa:${user.id}`, 5, 5 * 60_000)) return refuse("Too many attempts", "Wait five minutes and try again.");

  if (!(await bcrypt.compare(password, user.passwordHash))) return refuse("Password is wrong", "Type the password you sign in with.");
  if (verifyTotp(secret, code, Date.now(), user.totpLastStep) === null) {
    return refuse("That code did not match", "Type the current code from your authenticator.");
  }

  await db.user.update({
    where: { id: user.id },
    data: { twoFactor: false, totpSecret: null, totpLastStep: null },
  });
  await db.recoveryCode.deleteMany({ where: { userId: user.id } });
  await record(user, "account.twofactor.disabled", user.email, "WARNING");
  clearAttempts(`mfa:${user.id}`);

  return { ok: true, tone: "warning", title: "Two-factor is off", body: "A password is all that stands in front of this account now." };
}

/* At sign-in, after the password: a code from the authenticator, or a
   recovery code. Bounded to five tries in five minutes per account,
   which against a six-digit code is what makes the code worth having. */
export async function verifySecondFactorOp(
  userId: string,
  typed: string,
): Promise<{ ok: true; via: "totp" | "recovery"; remaining: number } | Refused> {
  if (!attempt(`mfa:${userId}`, 5, 5 * 60_000)) return refuse("Too many attempts", "Wait five minutes and try again.");

  const user = await db.user.findUnique({ where: { id: userId } });
  const secret = user ? secretOf(user) : null;
  if (!user || !user.twoFactor || !secret) return refuse("Sign in again", "This account does not need a code.");

  if (looksLikeTotp(typed)) {
    const step = verifyTotp(secret, typed, Date.now(), user.totpLastStep);
    if (step === null) return refuse("That code did not match", "Codes change every thirty seconds; try the current one.");
    await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    clearAttempts(`mfa:${userId}`);
    const remaining = await db.recoveryCode.count({ where: { userId, usedAt: null } });
    return { ok: true, via: "totp", remaining };
  }

  const normalised = normaliseRecoveryCode(typed);
  if (normalised.length < 8) return refuse("That code did not match", "A code is six digits, or a recovery code.");
  /* Spent in the same statement that finds it, so one recovery code
     cannot be used twice by two requests at once. */
  const spent = await db.recoveryCode.updateMany({
    where: { userId, hash: sha256(normalised), usedAt: null },
    data: { usedAt: new Date() },
  });
  if (spent.count !== 1) return refuse("That code did not match", "A recovery code works once; check it was not used before.");
  clearAttempts(`mfa:${userId}`);
  const remaining = await db.recoveryCode.count({ where: { userId, usedAt: null } });
  await record(user, "account.recovery.used", `${remaining} left`, "WARNING");
  return { ok: true, via: "recovery", remaining };
}

/** What the account page shows: nothing secret, only states and counts. */
export async function accountOverview(userId: string) {
  const [sessions, codes, user] = await Promise.all([
    db.session.count({ where: { userId } }),
    db.recoveryCode.count({ where: { userId, usedAt: null } }),
    db.user.findUnique({ where: { id: userId }, select: { twoFactor: true, totpSecret: true, passwordSetAt: true, role: true } }),
  ]);
  return {
    sessions,
    recoveryCodesLeft: codes,
    twoFactor: user?.twoFactor ?? false,
    // A secret with the flag off is an enrolment that was started and not finished.
    enrolling: !!user?.totpSecret && !user?.twoFactor,
    passwordSetAt: user?.passwordSetAt ?? null,
    required: user ? requiresTwoFactor(user.role) : false,
  };
}
