"use server";

import { requireUser } from "@/lib/auth";
import { sendConsoleCommandOp, type OpResult } from "@/lib/server-ops";

export async function sendConsoleCommand(slug: string, command: string): Promise<OpResult> {
  return sendConsoleCommandOp(await requireUser(), slug, command);
}
