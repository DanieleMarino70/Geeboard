"use server";

import { revalidatePath } from "next/cache";
import { createMemberOp, issueResetLinkOp } from "@/lib/account-ops";
import { requireUser } from "@/lib/auth";
import { panelUrl } from "@/lib/panel-url";
import {
  changeMemberRoleOp,
  removeMemberOp,
  type OpResult,
} from "@/lib/server-ops";

/* A one-time link comes back with the result and is shown once; the
   panel sends no email, so the admin hands it over themselves. */
export type LinkResult = OpResult & { link?: string; expiresAt?: Date };

/* The arguments of an action are what the browser sent, whatever the declared types say, so they are `unknown` here and the operations narrow
   them (domain/access/inputs.ts): an object where a role is declared is how an admin once made an account an owner. */
export async function createMember(input: { name: unknown; email: unknown; role: unknown }): Promise<LinkResult> {
  const r = await createMemberOp(await requireUser(), input, await panelUrl());
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function issueResetLink(memberId: unknown): Promise<LinkResult> {
  const r = await issueResetLinkOp(await requireUser(), memberId, await panelUrl());
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function changeMemberRole(memberId: unknown, role: unknown): Promise<OpResult> {
  const r = await changeMemberRoleOp(await requireUser(), memberId, role);
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function removeMember(memberId: unknown): Promise<OpResult> {
  const r = await removeMemberOp(await requireUser(), memberId);
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}
