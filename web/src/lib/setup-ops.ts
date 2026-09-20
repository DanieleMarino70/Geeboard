import "server-only";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { TEMPORARY_PASSWORD_TTL_MS, initialsOf } from "@/domain/access/account";
import { PlatformError } from "@/domain/errors";
import { db } from "./db";
import { SCHEDULER_EMAIL } from "./system-user";

/* The first owner of an installation, and the way back in for one who is
   locked out. Both are run from a terminal on the machine the panel
   lives on — see scripts/setup.mts and scripts/admin-recover.mts — and
   that is the whole of their authentication: somebody who can run a
   command as the panel, against the panel's database, already has
   everything the panel protects.

   Neither is reachable from the web. There is no first-run page that
   makes an owner for whoever gets to it first, because on a VPS the
   first to reach a new port is as often a scanner as the person who
   installed it.

   The password is temporary: random, returned once to be shown in the
   terminal, stored only as a hash, good for a day, and useless for
   anything but replacing itself — see accountGate. */

const BCRYPT_COST = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Twenty characters from an alphabet with no look-alikes, in fives: read
   off a terminal and typed into a browser, perhaps on another machine.
   Fifty-five symbols twenty times is about 115 bits, which for a password
   that works for a day is plenty. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function temporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 5; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

export type SetupResult =
  | { ok: true; email: string; name: string; password: string; expiresAt: Date }
  | { ok: false; reason: string };

/** Accounts that are people. The scheduler's own is not one. */
function people() {
  return { email: { not: SCHEDULER_EMAIL } };
}

export async function createFirstOwnerOp(input: { email: string; name: string }): Promise<SetupResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL.test(email)) return { ok: false, reason: "That is not an email address." };
  if (name.length < 2 || name.length > 80) return { ok: false, reason: "A name needs 2 to 80 characters." };

  /* Refused outright once anybody exists. This makes the first owner and
     is not a way to make a second: a second owner is added from Members,
     by the first, where it is audited under their name. */
  const existing = await db.user.count({ where: people() });
  if (existing > 0) {
    return {
      ok: false,
      reason:
        `This installation already has ${existing === 1 ? "an account" : `${existing} accounts`}. ` +
        "Setup only makes the first owner. To get back into an owner account, run: npm run admin:recover",
    };
  }

  const password = temporaryPassword();
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  /* Counted again inside a serializable transaction, so two people running
     this at the same moment cannot both read "nobody" and each make an
     owner. Postgres fails one of them, and it says the same thing as the
     check above. */
  let user;
  try {
    user = await db.$transaction(
      async (tx) => {
        if ((await tx.user.count({ where: people() })) > 0) {
          throw new PlatformError("CONFLICT", "This installation already has an account.");
        }
        return tx.user.create({
          data: {
            email,
            name,
            initials: initialsOf(name),
            role: "OWNER",
            passwordHash,
            passwordSetAt: null,
            temporaryPasswordExpiresAt: expiresAt,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof PlatformError
          ? `${error.message} Setup only makes the first owner. To get back into an owner account, run: npm run admin:recover`
          : `The account was not created: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  await db.activityEvent.create({
    data: {
      actor: "Setup",
      action: "installation.owner.created",
      target: email,
      tone: "WARNING",
      userId: user.id,
      changes: { "Temporary password": { from: "—", to: `expires ${expiresAt.toISOString()}` } },
    },
  });
  return { ok: true, email, name, password, expiresAt };
}

/* A new temporary password for an owner, from the panel's own machine.

   For the owner who lost the temporary password before using it, whose
   day ran out, who forgot their own, or whose phone and recovery codes
   are both gone — so it also removes two-factor, which the owner is then
   walked through setting up again, and ends every session the account
   has. Owners only: everybody else is reset from Members by an owner,
   where there is a name to put in the audit log. */
export async function recoverOwnerOp(input: { email?: string }): Promise<SetupResult> {
  const owners = await db.user.findMany({ where: { role: "OWNER", ...people() }, orderBy: { createdAt: "asc" } });
  if (owners.length === 0) {
    return { ok: false, reason: "There is no owner account to recover. On a new installation, run: npm run setup" };
  }

  const wanted = input.email?.trim().toLowerCase();
  const owner = wanted ? owners.find((o) => o.email === wanted) : owners.length === 1 ? owners[0] : undefined;
  if (!owner) {
    return {
      ok: false,
      reason: wanted
        ? `${wanted} is not an owner of this installation.`
        : `There are ${owners.length} owners; say which: npm run admin:recover -- --email <address>\n  ${owners.map((o) => o.email).join("\n  ")}`,
    };
  }

  const password = temporaryPassword();
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS);
  const [, sessions] = await db.$transaction([
    db.user.update({
      where: { id: owner.id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        passwordSetAt: null,
        temporaryPasswordExpiresAt: expiresAt,
        twoFactor: false,
        totpSecret: null,
        totpLastStep: null,
      },
    }),
    db.session.deleteMany({ where: { userId: owner.id } }),
    db.recoveryCode.deleteMany({ where: { userId: owner.id } }),
    db.accountToken.deleteMany({ where: { userId: owner.id, usedAt: null } }),
  ]);
  await db.activityEvent.create({
    data: {
      actor: "Recovery",
      action: "installation.owner.recovered",
      target: owner.email,
      tone: "DANGER",
      userId: owner.id,
      changes: {
        "Two-factor": { from: owner.twoFactor ? "on" : "off", to: "removed" },
        Sessions: { from: String(sessions.count), to: "0" },
        "Temporary password": { from: "—", to: `expires ${expiresAt.toISOString()}` },
      },
    },
  });
  return { ok: true, email: owner.email, name: owner.name, password, expiresAt };
}
