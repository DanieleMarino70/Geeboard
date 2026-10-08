import { allows, begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { createTaskOp } from "@/lib/task-ops";
import { TASK_KIND_IS_COMMAND, TASK_KIND_PERMISSION } from "@/lib/task-rules";
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
    // The text of a command is read by whoever may watch the console, and by nobody else, as in the audit log.
    const reads = allows(principal, "server.console.read", server.ownerId);
    return ok({ server: server.slug, tasks: tasks.map((t) => taskShape(t, reads || !TASK_KIND_IS_COMMAND[t.kind])) });
  } catch (error) {
    return fail(error);
  }
}

/* POST /api/v1/servers/:id/tasks

   Body: name, kind (BACKUP, RESTART, BROADCAST, COMMAND, CLEANUP, VERIFY),
   cron (five fields), payload (the message, the command, "keep N" or N, or
   a verification's mode; null for the kinds that take none). The
   same rules as the scheduler's form: every minute is refused, a
   broadcast on a game that cannot broadcast is refused. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.schedule.write", server.ownerId);

    const input = taskInputOf(await jsonBody<Record<string, unknown>>(req));
    // What the task does is asked of the key as well as of the role (lib/task-rules.ts): `servers:write` alone does not type in a console.
    if (Object.hasOwn(TASK_KIND_PERMISSION, input.kind)) mustAllow(principal, TASK_KIND_PERMISSION[input.kind], server.ownerId);
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
