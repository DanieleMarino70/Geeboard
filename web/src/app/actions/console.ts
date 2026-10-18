"use server";

import { requireUser } from "@/lib/auth";
import { findConsoleCommandsOp, type FoundCommands } from "@/lib/console-commands-ops";
import { sendConsoleCommandOp, type OpResult } from "@/lib/server-ops";

export async function sendConsoleCommand(slug: string, command: string): Promise<OpResult> {
  return sendConsoleCommandOp(await requireUser(), slug, command);
}

export async function findConsoleCommands(slug: string): Promise<FoundCommands> {
  return findConsoleCommandsOp(await requireUser(), slug);
}
