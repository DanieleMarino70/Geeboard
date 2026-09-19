"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
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

export async function createMember(input: { name: string; email: string; role: Role }): Promise<LinkResult> {
  const r = await createMemberOp(await requireUser(), input, await panelUrl());
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function issueResetLink(memberId: string): Promise<LinkResult> {
  const r = await issueResetLinkOp(await requireUser(), memberId, await panelUrl());
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function changeMemberRole(memberId: string, role: Role): Promise<OpResult> {
  const r = await changeMemberRoleOp(await requireUser(), memberId, role);
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}

export async function removeMember(memberId: string): Promise<OpResult> {
  const r = await removeMemberOp(await requireUser(), memberId);
  if (r.ok) {
    revalidatePath("/members");
    revalidatePath("/audit");
  }
  return r;
}
