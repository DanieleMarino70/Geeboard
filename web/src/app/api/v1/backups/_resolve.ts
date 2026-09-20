import "server-only";
import { PlatformError } from "@/domain/errors";
import { db } from "@/lib/db";

/* A backup by id, with whose it is for the permission check: its
   server's owner, or — once that server has been deleted and the backup
   has outlived it in the bucket — the owner it had. */
export async function resolveBackup(id: string) {
  const backup = await db.backup.findUnique({
    where: { id },
    include: { server: { select: { slug: true, ownerId: true } } },
  });
  if (!backup) throw new PlatformError("NOT_FOUND", "No backup by that id.", { details: { backup: id } });
  return { ...backup, ownerId: backup.server?.ownerId ?? backup.originOwnerId };
}
