import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import type { RuntimeFileEntry } from "@/domain/runtime/types";
import { db } from "./db";
import type { OpResult } from "./server-ops";

/* A server's files, as operations.

   These used to live in the Files page's server actions, which meant the
   HTTP API could not offer them without a second copy of the rules.
   Now the page and the API call the same functions.

   File access is a privileged capability: it reaches config, worlds and
   anything an operator has dropped on disk. Reading and writing are
   separate permissions, and neither of them comes with console access —
   a moderator who can watch a server does not thereby get its
   filesystem. See src/domain/access/permissions.ts. */

async function reach(user: User, slug: string, need: "server.files.read" | "server.files.write") {
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

  return { ok: true as const, server, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

function fault(error: unknown, fallback: string) {
  const platform = asPlatformError(error);
  return platform.code === "INTERNAL" ? fallback : platform.message;
}

/* A file's bytes, for the API: a plugin jar up, a map or a log bundle
   down. The panel is a pipe here and nothing more — the stream goes
   through it without being gathered, so a file's size is the node's
   limit to enforce and not this process's memory.

   An upload is an audit entry like a save, with its size; a download is
   not, for the same reason reading a config is not. */
export async function downloadFileOp(
  user: User,
  slug: string,
  at: string,
): Promise<{ ok: true; body: ReadableStream<Uint8Array>; sizeBytes: number; name: string } | { ok: false; error: string }> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const file = await r.runtime.files.readRaw(r.ref, at);
    return { ok: true, ...file, name: at.split("/").filter(Boolean).pop() ?? "file" };
  } catch (error) {
    return { ok: false, error: fault(error, "the agent could not read that file") };
  }
}

export async function uploadFileOp(
  user: User,
  slug: string,
  at: string,
  body: ReadableStream<Uint8Array>,
): Promise<(OpResult & { entry?: RuntimeFileEntry })> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot upload", body: r.error };
  try {
    const entry = await r.runtime.files.writeRaw(r.ref, at, body);
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "file.uploaded",
        target: at,
        tone: "ACCENT",
        userId: user.id,
        serverId: r.server.id,
        changes: { Size: { from: "—", to: `${entry.sizeBytes} bytes` } },
      },
    });
    return { ok: true, tone: "success", title: "Uploaded", body: `${entry.name} · ${entry.sizeBytes} bytes.`, entry };
  } catch (error) {
    return { ok: false, title: "Cannot upload", body: fault(error, "the agent refused the upload") };
  }
}

export interface ListResult {
  ok: boolean;
  path: string;
  entries: RuntimeFileEntry[];
  error?: string;
}

export async function listFilesOp(user: User, slug: string, at: string): Promise<ListResult> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, path: at, entries: [], error: r.error };

  try {
    const result = await r.runtime.files.list(r.ref, at);
    return { ok: true, path: result.path, entries: result.entries };
  } catch (error) {
    return { ok: false, path: at, entries: [], error: fault(error, "could not read that directory") };
  }
}

export interface ReadResult {
  ok: boolean;
  content: string;
  truncated: boolean;
  sizeBytes: number;
  error?: string;
}

export async function readFileOp(user: User, slug: string, at: string): Promise<ReadResult> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, content: "", truncated: false, sizeBytes: 0, error: r.error };

  try {
    const file = await r.runtime.files.read(r.ref, at);
    return { ok: true, ...file };
  } catch (error) {
    return { ok: false, content: "", truncated: false, sizeBytes: 0, error: fault(error, "could not read that file") };
  }
}

export async function writeFileOp(user: User, slug: string, at: string, content: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot save", body: r.error };

  try {
    const entry = await r.runtime.files.write(r.ref, at, content);
    await db.activityEvent.create({
      data: { actor: user.name, action: "file.written", target: at, tone: "ACCENT", userId: user.id, serverId: r.server.id },
    });
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

export async function makeDirectoryOp(user: User, slug: string, at: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot create", body: r.error };

  try {
    await r.runtime.files.makeDirectory(r.ref, at);
    return { ok: true, tone: "success", title: "Folder created", body: at };
  } catch (error) {
    return { ok: false, title: "Cannot create", body: fault(error, "the agent refused it") };
  }
}

export async function deleteEntryOp(user: User, slug: string, at: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot delete", body: r.error };

  try {
    await r.runtime.files.remove(r.ref, at);
    await db.activityEvent.create({
      data: { actor: user.name, action: "file.deleted", target: at, tone: "DANGER", userId: user.id, serverId: r.server.id },
    });
    return { ok: true, tone: "warning", title: "Deleted", body: `${at} is gone.` };
  } catch (error) {
    return { ok: false, title: "Cannot delete", body: fault(error, "the agent refused it") };
  }
}
