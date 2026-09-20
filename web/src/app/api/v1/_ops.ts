import "server-only";
import type { User } from "@prisma/client";
import { PlatformError, type ErrorCode } from "@/domain/errors";
import type { Principal } from "@/lib/api";
import { db } from "@/lib/db";
import type { OpResult } from "@/lib/server-ops";
import { TASK_KINDS, type TaskInput } from "@/lib/task-rules";

/* What every writing route needs and none should repeat.

   The operations in lib/*-ops.ts take a user row and answer with an
   OpResult written for a person. A route turns the principal into that
   row, and a refusal into a coded error — the same message, since it
   was already written for someone, under a code a program can switch
   on. That is the whole of the API's own logic: nothing here decides
   anything the panel's buttons do not decide the same way. */

/** The user row behind a principal, which the operations take. */
export async function actorOf(principal: Principal): Promise<User> {
  const user = await db.user.findUnique({ where: { id: principal.id } });
  if (!user) throw new PlatformError("UNAUTHENTICATED", "That account no longer exists.");
  return user;
}

/* A refused operation as an error. "Not permitted" is the one refusal
   worth its own code: it is the operation's own permission check
   disagreeing with a caller the route already let through, which a
   client should read as FORBIDDEN and not as a state problem. */
export function refusal(result: Extract<OpResult, { ok: false }>, code: ErrorCode = "SERVER_STATE_INVALID", details?: Record<string, unknown>): never {
  const chosen: ErrorCode = /^Not permitted$/i.test(result.title) ? "FORBIDDEN" : code;
  throw new PlatformError(chosen, `${result.title}. ${result.body}`, { details });
}

/** The JSON body, or an empty object for a request that sent none. */
export async function jsonBody<T extends Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PlatformError("VALIDATION_FAILED", "The body has to be a JSON object.");
    }
    return parsed as Partial<T>;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError("VALIDATION_FAILED", "The body is not valid JSON.");
  }
}

/** A required string field, trimmed; missing or empty is a validation error. */
export function required(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is required.`, { details: { field } });
  }
  return value.trim();
}

/** A query parameter that has to be there. */
export function queryParam(req: Request, name: string): string {
  const value = new URL(req.url).searchParams.get(name);
  if (value === null || value.length === 0) {
    throw new PlatformError("VALIDATION_FAILED", `The ${name} query parameter is required.`, { details: { field: name } });
  }
  return value;
}

/* The file operations answer with a sentence; the code a client needs
   is which kind of sentence it was. */
export function reachCode(message: string | undefined): ErrorCode {
  if (!message) return "RUNTIME_REJECTED";
  if (/no agent attached/i.test(message)) return "RUNTIME_NOT_ATTACHED";
  if (/no longer exists|no such|not found/i.test(message)) return "NOT_FOUND";
  if (/permission|file access/i.test(message)) return "FORBIDDEN";
  return "RUNTIME_REJECTED";
}

/** A scheduled task as a client sends it, checked for shape; the rules are the operation's. */
export function taskInputOf(body: Record<string, unknown>): TaskInput {
  const kind = required(body, "kind").toUpperCase();
  if (!(TASK_KINDS as readonly string[]).includes(kind)) {
    throw new PlatformError("VALIDATION_FAILED", `kind has to be one of ${TASK_KINDS.join(", ")}.`, { details: { field: "kind" } });
  }
  const payload = body.payload;
  if (payload !== undefined && typeof payload !== "string") {
    throw new PlatformError("VALIDATION_FAILED", "payload has to be text.", { details: { field: "payload" } });
  }
  return {
    name: required(body, "name"),
    kind: kind as TaskInput["kind"],
    cron: required(body, "cron"),
    payload: (payload as string | undefined) ?? "",
  };
}

/** The message a successful operation gives, in one field. */
export function said(result: Extract<OpResult, { ok: true }>): string {
  return `${result.title}. ${result.body}`;
}
