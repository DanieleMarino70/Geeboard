"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { temporaryPasswordExpired } from "@/domain/access/account";
import { returnPath } from "@/domain/access/return-to";
import { verifySecondFactorOp } from "@/lib/account-ops";
import { attempt, clearAttempts } from "@/lib/attempts";
import {
  beginSecondFactor,
  createSession,
  destroySession,
  endSecondFactor,
  pendingSecondFactor,
  verifyCredentials,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { recoveryCommand, whereToRun } from "@/lib/panel-commands";

/* `command` is something to type on the machine the panel runs on, shown apart from the sentence so it can be
   copied whole, on a phone as well. */
export type SignInState = { error?: string; command?: string; email?: string };

/* The page the person asked for before they were asked to sign in. It travels as a hidden field, comes from the
   address bar, and is a path inside this panel or nothing (domain/access/return-to.ts). */
function nextOf(formData: FormData): string | null {
  return returnPath(formData.get("next"));
}

function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent") ?? undefined,
  };
}

async function open(userId: string) {
  await createSession(userId, await requestMeta());
  await db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  /* A form that fails is emptied by React, the address with it. The one typed is handed back so that the next try is
     the password and not both: a person who has just been told their temporary password expired should not have to
     type their address again to copy the command that fixes it. */
  if (!email || !password) return { error: "Enter your email and password.", email };

  /* Ten tries a quarter hour per address, and the same per source, so a
     list of passwords against one account and one password against a
     list of accounts both run out of road. */
  const { ip } = await requestMeta();
  if (!attempt(`signin:${email}`, 10, 15 * 60_000) || !attempt(`signin-ip:${ip ?? "local"}`, 30, 15 * 60_000)) {
    return { error: "Too many attempts. Wait a few minutes and try again.", email };
  }

  const user = await verifyCredentials(email, password);
  if (!user) return { error: "That email and password do not match an account.", email };
  clearAttempts(`signin:${email}`);

  /* Said only to somebody who has just typed the right password, so it
     tells a stranger nothing: a temporary password is good for a day. */
  if (temporaryPasswordExpired(user)) {
    return {
      error: `That temporary password has expired — it was good for a day. ${whereToRun()} this makes a new one:`,
      command: recoveryCommand({ email: user.email }),
      email,
    };
  }

  const next = nextOf(formData);
  if (user.twoFactor) {
    // No session yet: the code page decides.
    await beginSecondFactor(user.id);
    redirect(withNext("/sign-in/two-factor", next));
  }

  await open(user.id);
  redirect(next ?? "/");
}

/* The second step. The account comes from the short-lived cookie the
   first step set, never from the form, so nothing typed here can name
   somebody else's account. */
export async function verifySecondFactor(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const userId = await pendingSecondFactor();
  if (!userId) redirect("/sign-in");

  const code = String(formData.get("code") ?? "");
  if (!code.trim()) return { error: "Type the code from your authenticator, or a recovery code." };

  const result = await verifySecondFactorOp(userId, code);
  if (!result.ok) return { error: `${result.title}. ${result.body}` };

  await endSecondFactor();
  await open(userId);
  // A recovery code used is worth a word on the account page.
  redirect(result.via === "recovery" ? "/account?recovered=1" : (nextOf(formData) ?? "/"));
}

export async function signOut() {
  await destroySession();
  redirect("/sign-in");
}
