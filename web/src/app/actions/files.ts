"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AgentError, agentFor, type FileEntry } from "@/lib/daemon-client";
import { db } from "@/lib/db";
import type { OpResult } from "@/lib/server-ops";

/* File access is a privileged capability: it reaches config, worlds and
   anything an operator has dropped on disk. Only owners, admins and the
   server's own owner get it — a moderator with console access does not
   automatically get the filesystem. */

async function reach(slug: string) {
  const user = await requireUser();
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return { ok: false as const, error: "That server no longer exists." };

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  if (!privileged && server.ownerId !== user.id) {
    return { ok: false as const, error: "You do not have file access to this server." };
  }

  const agent = agentFor(server.node);
  if (!agent) {
    return {
      ok: false as const,
      error: `${server.node.name} has no agent attached, so its files are not reachable.`,
    };
  }

  return { ok: true as const, user, server, agent };
}

function fault(error: unknown, fallback: string) {
  return error instanceof AgentError ? error.message : fallback;
}

export interface ListResult {
  ok: boolean;
  path: string;
  entries: FileEntry[];
  error?: string;
}

export async function listFiles(slug: string, at: string): Promise<ListResult> {
  const r = await reach(slug);
  if (!r.ok) return { ok: false, path: at, entries: [], error: r.error };

  try {
    const result = await r.agent.listFiles(r.server.id, at);
    return { ok: true, path: result.path, entries: result.entries };
  } catch (error) {
    return { ok: false, path: at, entries: [], error: fault(error, "could not read that directory") };
  }
}

export async function readFile(
  slug: string,
  at: string,
): Promise<{ ok: boolean; content: string; truncated: boolean; sizeBytes: number; error?: string }> {
  const r = await reach(slug);
  if (!r.ok) return { ok: false, content: "", truncated: false, sizeBytes: 0, error: r.error };

  try {
    const file = await r.agent.readFile(r.server.id, at);
    return { ok: true, ...file };
  } catch (error) {
    return {
      ok: false,
      content: "",
      truncated: false,
      sizeBytes: 0,
      error: fault(error, "could not read that file"),
    };
  }
}

export async function saveFile(slug: string, at: string, content: string): Promise<OpResult> {
  const r = await reach(slug);
  if (!r.ok) return { ok: false, title: "Cannot save", body: r.error };

  try {
    const entry = await r.agent.writeFile(r.server.id, at, content);
    await db.activityEvent.create({
      data: {
        actor: r.user.name,
        action: "file.written",
        target: at,
        tone: "ACCENT",
        userId: r.user.id,
        serverId: r.server.id,
      },
    });
    revalidatePath("/files");
    return {
      ok: true,
      tone: "success",
      title: "Saved",
      body: `${entry.name} · ${entry.sizeBytes} bytes. The server picks it up on the next restart.`,
    };
  } catch (error) {
    return { ok: false, title: "Cannot save", body: fault(error, "the agent refused the write") };
  }
}

export async function createDirectory(slug: string, at: string): Promise<OpResult> {
  const r = await reach(slug);
  if (!r.ok) return { ok: false, title: "Cannot create", body: r.error };

  try {
    await r.agent.makeDirectory(r.server.id, at);
    revalidatePath("/files");
    return { ok: true, tone: "success", title: "Folder created", body: at };
  } catch (error) {
    return { ok: false, title: "Cannot create", body: fault(error, "the agent refused it") };
  }
}

export async function deleteEntry(slug: string, at: string): Promise<OpResult> {
  const r = await reach(slug);
  if (!r.ok) return { ok: false, title: "Cannot delete", body: r.error };

  try {
    await r.agent.deleteFile(r.server.id, at);
    await db.activityEvent.create({
      data: {
        actor: r.user.name,
        action: "file.deleted",
        target: at,
        tone: "DANGER",
        userId: r.user.id,
        serverId: r.server.id,
      },
    });
    revalidatePath("/files");
    return { ok: true, tone: "warning", title: "Deleted", body: `${at} is gone.` };
  } catch (error) {
    return { ok: false, title: "Cannot delete", body: fault(error, "the agent refused it") };
  }
}
