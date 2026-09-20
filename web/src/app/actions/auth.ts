"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { temporaryPasswordExpired } from "@/domain/access/account";
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

export type SignInState = { error?: string };

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

  if (!email || !password) return { error: "Enter your email and password." };

  /* Ten tries a quarter hour per address, and the same per source, so a
     list of passwords against one account and one password against a
     list of accounts both run out of road. */
  const { ip } = await requestMeta();
  if (!attempt(`signin:${email}`, 10, 15 * 60_000) || !attempt(`signin-ip:${ip ?? "local"}`, 30, 15 * 60_000)) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const user = await verifyCredentials(email, password);
  if (!user) return { error: "That email and password do not match an account." };
  clearAttempts(`signin:${email}`);

  /* Said only to somebody who has just typed the right password, so it
     tells a stranger nothing: a temporary password is good for a day. */
  if (temporaryPasswordExpired(user)) {
    return {
      error:
        "That temporary password has expired — it was good for a day. On the machine the panel runs on, `npm run admin:recover` makes a new one.",
    };
  }

  if (user.twoFactor) {
    // No session yet: the code page decides.
    await beginSecondFactor(user.id);
    redirect("/sign-in/two-factor");
  }

  await open(user.id);
  redirect("/");
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
  redirect(result.via === "recovery" ? "/account?recovered=1" : "/");
}

export async function signOut() {
  await destroySession();
  redirect("/sign-in");
}
