import type { Role } from "@prisma/client";

/* What a server action may be handed, checked where it arrives.

   A server action is a public POST endpoint. Its parameter types are written for the compiler, and the browser sends whatever it likes: an
   object where a string is declared passes every `=== "OWNER"` comparison as "not the owner" and is then read by the database layer as an
   operator (`{ set: "OWNER" }` is a valid Prisma value for an enum column). The audit of 0.9.5 found exactly that in the role change, where
   an admin could make an account an owner and leave no line behind. So an argument that decides something is narrowed to the one thing it
   may be before anything compares it, and the operation checks it again, because the operations are called from places other than the action. */

export const ROLES = ["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const satisfies readonly Role[];

/** The role this value names, or null: only a string that is one of the four, never an object that Prisma would read as an operation. */
export function asRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

/** An identifier, as a string of a sensible length, or null. The database is asked about it by equality, so an object is never one. */
export function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

export const BACKUP_STORES = ["LOCAL", "S3"] as const;
export type BackupStoreName = (typeof BACKUP_STORES)[number];

/** Where a backup is kept, or null. `{ set: "S3" }` is accepted by Prisma and would record a local archive as an off-site one. */
export function asBackupStore(value: unknown): BackupStoreName | null {
  return typeof value === "string" && (BACKUP_STORES as readonly string[]).includes(value) ? (value as BackupStoreName) : null;
}
