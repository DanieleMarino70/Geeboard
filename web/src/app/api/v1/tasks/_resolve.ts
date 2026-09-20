import "server-only";
import { PlatformError } from "@/domain/errors";
import { db } from "@/lib/db";

/** A scheduled task by id, with the server it belongs to for the permission check. */
export async function resolveTask(id: string) {
  const task = await db.scheduledTask.findUnique({
    where: { id },
    include: { server: { select: { slug: true, ownerId: true } } },
  });
  if (!task) throw new PlatformError("NOT_FOUND", "No task by that id.", { details: { task: id } });
  return task;
}
