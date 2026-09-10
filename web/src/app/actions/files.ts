"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeFileEntry } from "@/domain/runtime/types";
import { db } from "@/lib/db";
import type { OpResult } from "@/lib/server-ops";

/* File access is a privileged capability: it reaches config, worlds and
   anything an operator has dropped on disk. Reading and writing are
   separate permissions, and neither of them comes with console access —
   a moderator who can watch a server does not thereby get its
   filesystem. See src/domain/access/permissions.ts. */

async function reach(slug: string, need: "server.files.read" | "server.files.write") {
  const user = await requireUser();
  const server = await db.server.findUnique({
    where: { slug },
    include: { node: { select: { name: true, daemonUrl: true, daemonToken: true } } },
  });
  if (!server) return { ok: false as const, error: "That server no longer exists." };

  if (!can(user, need, server.ownerId)) {
    return {
      ok: false as const,
      error:
        need === "server.files.write"
          ? "You do not have permission to change this server's files."
          : "You do not have file access to this server.",
    };
  }

  const runtime = runtimeFor(server.node);
  if (!runtime) {
    return {
      ok: false as const,
      error: `${server.node.name} has no agent attached, so its files are not reachable.`,
    };
  }

  return { ok: true as const, user, server, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

function fault(error: unknown, fallback: string) {
  const platform = asPlatformError(error);
  return platform.code === "INTERNAL" ? fallback : platform.message;
}

export interface ListResult {
  ok: boolean;
  path: string;
  entries: RuntimeFileEntry[];
  error?: string;
}

export async function listFiles(slug: string, at: string): Promise<ListResult> {
  const r = await reach(slug, "server.files.read");
  if (!r.ok) return { ok: false, path: at, entries: [], error: r.error };

  try {
    const result = await r.runtime.files.list(r.ref, at);
    return { ok: true, path: result.path, entries: result.entries };
  } catch (error) {
    return { ok: false, path: at, entries: [], error: fault(error, "could not read that directory") };
  }
}

export async function readFile(
  slug: string,
  at: string,
): Promise<{ ok: boolean; content: string; truncated: boolean; sizeBytes: number; error?: string }> {
  const r = await reach(slug, "server.files.read");
  if (!r.ok) return { ok: false, content: "", truncated: false, sizeBytes: 0, error: r.error };

  try {
    const file = await r.runtime.files.read(r.ref, at);
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
  const r = await reach(slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot save", body: r.error };

  try {
    const entry = await r.runtime.files.write(r.ref, at, content);
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
  const r = await reach(slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot create", body: r.error };

  try {
    await r.runtime.files.makeDirectory(r.ref, at);
    revalidatePath("/files");
    return { ok: true, tone: "success", title: "Folder created", body: at };
  } catch (error) {
    return { ok: false, title: "Cannot create", body: fault(error, "the agent refused it") };
  }
}

export async function deleteEntry(slug: string, at: string): Promise<OpResult> {
  const r = await reach(slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot delete", body: r.error };

  try {
    await r.runtime.files.remove(r.ref, at);
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
