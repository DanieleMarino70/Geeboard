"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import {
  changeMemberRoleOp,
  removeMemberOp,
  type OpResult,
} from "@/lib/server-ops";

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
