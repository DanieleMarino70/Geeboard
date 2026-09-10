"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createServerOp, freePortFor, type CreateInput, type CreateResult } from "@/lib/create-ops";
import { gameById } from "@/lib/catalog";
import { db } from "@/lib/db";

/* Thin, like the other action files: resolve the user, call the
   operation, revalidate what the new server appears on. */

export async function createServer(input: CreateInput): Promise<CreateResult> {
  const result = await createServerOp(await requireUser(), input);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/nodes");
    revalidatePath("/console");
  }
  return result;
}

/* The ports the wizard shows on the resources step. They are what the
   allocator would pick right now, not a promise — another server can
   take the block before this one is created, which is why the create
   allocates again rather than trusting what was displayed. */
export async function previewPorts(gameId: string, nodeName: string) {
  await requireUser();

  const game = gameById(gameId);
  const node = await db.node.findUnique({ where: { name: nodeName }, select: { id: true } });
  if (!game || !node) return { base: null as number | null };

  return { base: await freePortFor(game, node.id) };
}
