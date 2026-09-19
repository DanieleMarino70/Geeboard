import type { Role } from "@prisma/client";

/* The rules an account lives by, apart from the permission matrix.

   They are here, not in the operations, for the reason every domain
   rule is: the sign-in page, the account page, the Members page and the
   API front door all need the same answer to "must this person have
   two-factor?", and four copies of a rule drift. */

/* Two-factor is required by role, not by workspace. An owner or an admin
   reaches every node token, every secret and every world; a password
   alone in front of that is too little, whatever the workspace decided.
   Everyone else may enrol and is not made to, because an account made
   from the panel is handed a link and nothing else — a mandatory
   authenticator on day one is the sort of gate that ends with a shared
   password instead. */
export function requiresTwoFactor(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Signed in, but not let past the account page until enrolled. */
export function mustEnrol(user: { role: Role; twoFactor: boolean }): boolean {
  return requiresTwoFactor(user.role) && !user.twoFactor;
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/* Length is the one rule. Composition rules — a digit, a symbol — make
   passwords predictable, not strong; a long one of the person's own
   choosing is what bcrypt is for. The ceiling stops a megabyte of
   password from costing a megabyte of hashing. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/* A recovery code as typed: people copy them with or without the
   hyphens, in either case, with a stray space. All of those are the same
   code. */
export function normaliseRecoveryCode(typed: string): string {
  return typed.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether typed text is a six-digit authenticator code rather than a recovery code. */
export function looksLikeTotp(typed: string): boolean {
  return /^\s*\d{6}\s*$/.test(typed);
}

/* How long a one-time link lives. A setup link is handed over by a
   person and may sit in a chat for a while; a reset is for someone who
   is waiting for it. */
export const SETUP_LINK_TTL_MS = 7 * 24 * 3600_000;
export const RESET_LINK_TTL_MS = 24 * 3600_000;

/* Initials for an avatar: the first letters of the first two words, or
   the first two letters of a one-word name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "??").slice(0, 2);
  return letters.toUpperCase();
}
