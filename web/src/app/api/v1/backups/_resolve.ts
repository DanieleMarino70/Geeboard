import "server-only";
import { PlatformError } from "@/domain/errors";
import { db } from "@/lib/db";

/** A backup by id, with the server it belongs to for the permission check. */
export async function resolveBackup(id: string) {
  const backup = await db.backup.findUnique({
    where: { id },
    include: { server: { select: { slug: true, ownerId: true } } },
  });
  if (!backup) throw new PlatformError("NOT_FOUND", "No backup by that id.", { details: { backup: id } });
  return backup;
}
