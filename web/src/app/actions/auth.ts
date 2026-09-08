"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, verifyCredentials } from "@/lib/auth";
import { db } from "@/lib/db";

export type SignInState = { error?: string };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const user = await verifyCredentials(email, password);
  if (!user) return { error: "That email and password do not match an account." };

  const h = await headers();
  await createSession(user.id, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent") ?? undefined,
  });

  await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/sign-in");
}
