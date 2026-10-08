import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import { asPlatformError, type ErrorCode } from "@/domain/errors";
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
  if (!server) return { ok: false as const, error: "That server no longer exists.", code: "NOT_FOUND" as ErrorCode };

  if (!can(user, need, server.ownerId)) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as ErrorCode,
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
      code: "RUNTIME_NOT_ATTACHED" as ErrorCode,
      error: `${server.node.name} has no agent attached, so its files are not reachable.`,
    };
  }

  return { ok: true as const, server, runtime, ref: { serverId: server.id, runtimeId: server.runtimeId } };
}

/* What the person is shown for a failed file operation: the sentence the failure carries. An unexpected one used to be replaced by a
   lowercase fragment ("the agent refused it") that named the wrong party; it is the generic sentence with its reference now, and the
   log has the cause (lib/unexpected.ts). */
function fault(error: unknown, context: string): { message: string; code: ErrorCode } {
  const failure = asPlatformError(error, context);
  /* The agent answers a path that leaves the server's directory with a 400, which the runtime client turns into RUNTIME_REJECTED like any other
     refusal; it is the one the API documents as FORBIDDEN (a client alerting on 403 should see a traversal attempt), and it is recognised here,
     once, at the boundary where the agent's own sentence arrives, and nowhere further up. */
  const traversal = failure.code === "RUNTIME_REJECTED" && /escapes the server directory|contains a null byte|invalid server id/i.test(failure.message);
  return { message: failure.message, code: traversal ? "FORBIDDEN" : failure.code };
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
): Promise<{ ok: true; body: ReadableStream<Uint8Array>; sizeBytes: number; name: string } | { ok: false; error: string; code?: ErrorCode }> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  try {
    const file = await r.runtime.files.readRaw(r.ref, at);
    return { ok: true, ...file, name: at.split("/").filter(Boolean).pop() ?? "file" };
  } catch (error) {
    const f = fault(error, "reading a file");
    return { ok: false, error: f.message, code: f.code };
  }
}

export async function uploadFileOp(
  user: User,
  slug: string,
  at: string,
  body: ReadableStream<Uint8Array>,
  expectedBytes?: number,
): Promise<(OpResult & { entry?: RuntimeFileEntry })> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot upload", body: r.error, code: r.code };
  try {
    const entry = await r.runtime.files.writeRaw(r.ref, at, body, expectedBytes);
    /* An agent from 0.3.0 or before does not check the size, and has
       already put what arrived in place of the old file. Said, and the
       short file taken away, rather than called uploaded: a world cut
       at 10 MB was reported as uploaded and failed to load days later. */
    if (expectedBytes !== undefined && entry.sizeBytes !== expectedBytes) {
      await r.runtime.files.remove(r.ref, at).catch(() => {});
      return {
        ok: false,
        title: "Cannot upload",
        body: `Only ${entry.sizeBytes} of ${expectedBytes} bytes arrived, so the incomplete file was removed. A file of that name that was there before is gone too: this node's agent is older than 0.3.1 and replaced it before it could be checked.`,
      };
    }
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
    const f = fault(error, "uploading a file");
    return { ok: false, title: "Cannot upload", body: f.message, code: f.code };
  }
}

export interface ListResult {
  ok: boolean;
  path: string;
  entries: RuntimeFileEntry[];
  error?: string;
  code?: ErrorCode;
}

export async function listFilesOp(user: User, slug: string, at: string): Promise<ListResult> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, path: at, entries: [], error: r.error, code: r.code };

  try {
    const result = await r.runtime.files.list(r.ref, at);
    return { ok: true, path: result.path, entries: result.entries };
  } catch (error) {
    const f = fault(error, "listing a directory");
    return { ok: false, path: at, entries: [], error: f.message, code: f.code };
  }
}

export interface ReadResult {
  ok: boolean;
  content: string;
  truncated: boolean;
  sizeBytes: number;
  error?: string;
  code?: ErrorCode;
}

export async function readFileOp(user: User, slug: string, at: string): Promise<ReadResult> {
  const r = await reach(user, slug, "server.files.read");
  if (!r.ok) return { ok: false, content: "", truncated: false, sizeBytes: 0, error: r.error, code: r.code };

  try {
    const file = await r.runtime.files.read(r.ref, at);
    return { ok: true, ...file };
  } catch (error) {
    const f = fault(error, "reading a file");
    return { ok: false, content: "", truncated: false, sizeBytes: 0, error: f.message, code: f.code };
  }
}

export async function writeFileOp(user: User, slug: string, at: string, content: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot save", body: r.error, code: r.code };

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
    const f = fault(error, "saving a file");
    return { ok: false, title: "Cannot save", body: f.message, code: f.code };
  }
}

export async function makeDirectoryOp(user: User, slug: string, at: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot create", body: r.error, code: r.code };

  try {
    await r.runtime.files.makeDirectory(r.ref, at);
    return { ok: true, tone: "success", title: "Folder created", body: at };
  } catch (error) {
    const f = fault(error, "creating in the file manager");
    return { ok: false, title: "Cannot create", body: f.message, code: f.code };
  }
}

/* A new name for a file or a folder, in the folder it is in or another one inside the same server. The agent's move is a rename(2), which
   puts the source over whatever is at the destination without a word; a rename that took a world's `server.properties` and replaced a
   file somebody else had put there would be a data loss with a success message, so the destination is looked at first, and a name that is
   taken is refused with the sentence that says so. */
export async function moveEntryOp(user: User, slug: string, from: string, to: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot rename", body: r.error, code: r.code };

  const clean = (p: string) => p.split("/").filter(Boolean).join("/");
  const source = clean(from);
  const target = clean(to);
  if (!source || !target) return { ok: false, title: "Cannot rename", body: "Name what to rename and what to call it.", code: "VALIDATION_FAILED" };
  if (source === target) return { ok: false, title: "Cannot rename", body: "That is its name already.", code: "VALIDATION_FAILED" };
  if (target === source || target.startsWith(`${source}/`)) {
    return { ok: false, title: "Cannot rename", body: "A folder cannot be moved into itself.", code: "VALIDATION_FAILED" };
  }

  try {
    const parent = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "/";
    const name = target.slice(target.lastIndexOf("/") + 1);
    const there = await r.runtime.files.list(r.ref, parent).catch(() => null);
    if (there?.entries.some((entry) => entry.name === name)) {
      return {
        ok: false,
        title: "Cannot rename",
        body: `${name} is already ${parent === "/" ? "in the server's folder" : `in ${parent}`}. Delete or rename that one first: renaming over it would replace it.`,
        code: "CONFLICT",
      };
    }
    await r.runtime.files.move(r.ref, source, target);
    await db.activityEvent.create({
      data: {
        actor: user.name,
        action: "file.renamed",
        target: source,
        tone: "ACCENT",
        userId: user.id,
        serverId: r.server.id,
        changes: { Name: { from: source, to: target } },
      },
    });
    return { ok: true, tone: "success", title: "Renamed", body: `${source} is now ${target}.` };
  } catch (error) {
    const f = fault(error, "renaming in the file manager");
    return { ok: false, title: "Cannot rename", body: f.message, code: f.code };
  }
}

export async function deleteEntryOp(user: User, slug: string, at: string): Promise<OpResult> {
  const r = await reach(user, slug, "server.files.write");
  if (!r.ok) return { ok: false, title: "Cannot delete", body: r.error, code: r.code };

  try {
    await r.runtime.files.remove(r.ref, at);
    await db.activityEvent.create({
      data: { actor: user.name, action: "file.deleted", target: at, tone: "DANGER", userId: user.id, serverId: r.server.id },
    });
    return { ok: true, tone: "warning", title: "Deleted", body: `${at} is gone.` };
  } catch (error) {
    const f = fault(error, "deleting in the file manager");
    return { ok: false, title: "Cannot delete", body: f.message, code: f.code };
  }
}
