import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { createTaskOp } from "@/lib/task-ops";
import { actorOf, jsonBody, refusal, said, taskInputOf } from "../../../_ops";
import { taskShape } from "../../../_shape";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/servers/:id/tasks — the server's scheduled tasks. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.read", server.ownerId);

    const tasks = await db.scheduledTask.findMany({
      where: { serverId: server.id },
      orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }],
      include: { server: { select: { slug: true } } },
    });
    return ok({ server: server.slug, tasks: tasks.map(taskShape) });
  } catch (error) {
    return fail(error);
  }
}

/* POST /api/v1/servers/:id/tasks

   Body: name, kind (BACKUP, RESTART, BROADCAST, COMMAND, CLEANUP), cron
   (five fields), payload (the message, the command, or "keep N"). The
   same rules as the scheduler's form: every minute is refused, a
   broadcast on a game that cannot broadcast is refused. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.schedule.write", server.ownerId);

    const input = taskInputOf(await jsonBody<Record<string, unknown>>(req));
    const result = await createTaskOp(await actorOf(principal), server.slug, input);
    if (!result.ok) refusal(result, "VALIDATION_FAILED", { errors: result.errors ?? null });

    const task = await db.scheduledTask.findFirstOrThrow({
      where: { serverId: server.id, name: input.name },
      orderBy: { createdAt: "desc" },
      include: { server: { select: { slug: true } } },
    });
    return ok({ ...taskShape(task), message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
