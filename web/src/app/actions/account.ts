"use server";

import { revalidatePath } from "next/cache";
import {
  beginTwoFactorOp,
  changePasswordOp,
  completeSetupOp,
  confirmTwoFactorOp,
  disableTwoFactorOp,
  regenerateRecoveryCodesOp,
  signOutEverywhereOp,
} from "@/lib/account-ops";
import { currentSessionId, requireUser } from "@/lib/auth";
import type { OpResult } from "@/lib/server-ops";

/* Thin: resolve the person, call the operation, refresh what changed.
   Every action here asks for the user with `allowUnenrolled`, because
   the account page is where an owner who must enrol is sent — an action
   that turned them away again would leave no way to comply. */

const me = () => requireUser({ allowUnenrolled: true });

function refresh() {
  revalidatePath("/account");
  revalidatePath("/members");
  revalidatePath("/audit");
}

export async function changePassword(current: string, next: string): Promise<OpResult> {
  const r = await changePasswordOp(await me(), current, next, await currentSessionId());
  if (r.ok) refresh();
  return r;
}

export async function signOutEverywhere(): Promise<OpResult> {
  const r = await signOutEverywhereOp(await me(), await currentSessionId());
  if (r.ok) refresh();
  return r;
}

export type TwoFactorStart = OpResult & { secret?: string; uri?: string };
export type RecoveryCodes = OpResult & { codes?: string[] };

export async function beginTwoFactor(): Promise<TwoFactorStart> {
  return beginTwoFactorOp(await me());
}

export async function confirmTwoFactor(code: string): Promise<RecoveryCodes> {
  const r = await confirmTwoFactorOp(await me(), code);
  if (r.ok) refresh();
  return r;
}

export async function regenerateRecoveryCodes(code: string): Promise<RecoveryCodes> {
  const r = await regenerateRecoveryCodesOp(await me(), code);
  if (r.ok) refresh();
  return r;
}

export async function disableTwoFactor(password: string, code: string): Promise<OpResult> {
  const r = await disableTwoFactorOp(await me(), password, code);
  if (r.ok) refresh();
  return r;
}

/* Public: the person holding a setup link is not signed in. The link
   itself is the credential, and the operation spends it. */
export async function completeSetup(token: string, password: string): Promise<OpResult> {
  return completeSetupOp(token, password);
}
