"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  deleteEntryOp,
  listFilesOp,
  makeDirectoryOp,
  readFileOp,
  writeFileOp,
  type ListResult,
  type ReadResult,
} from "@/lib/file-ops";
import type { OpResult } from "@/lib/server-ops";

/* Thin, like the other action files: the rules and the reach to the
   node are in lib/file-ops.ts, which the HTTP API calls too. */

export type { ListResult } from "@/lib/file-ops";

export async function listFiles(slug: string, at: string): Promise<ListResult> {
  return listFilesOp(await requireUser(), slug, at);
}

export async function readFile(slug: string, at: string): Promise<ReadResult> {
  return readFileOp(await requireUser(), slug, at);
}

export async function saveFile(slug: string, at: string, content: string): Promise<OpResult> {
  const r = await writeFileOp(await requireUser(), slug, at, content);
  if (r.ok) revalidatePath("/files");
  return r;
}

export async function createDirectory(slug: string, at: string): Promise<OpResult> {
  const r = await makeDirectoryOp(await requireUser(), slug, at);
  if (r.ok) revalidatePath("/files");
  return r;
}

export async function deleteEntry(slug: string, at: string): Promise<OpResult> {
  const r = await deleteEntryOp(await requireUser(), slug, at);
  if (r.ok) revalidatePath("/files");
  return r;
}
