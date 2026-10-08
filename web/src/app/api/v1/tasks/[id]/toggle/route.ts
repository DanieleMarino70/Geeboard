import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { toggleTaskOp } from "@/lib/server-ops";
import { TASK_KIND_PERMISSION } from "@/lib/task-rules";
import { actorOf, refusal, said } from "../../../_ops";
import { taskShape } from "../../../_shape";
import { resolveTask } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/:id/toggle — enables a paused task, pauses a running one. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const task = await resolveTask(id);
    mustAllow(principal, "server.schedule.write", task.server.ownerId);
    // What the task does is asked of the key as well as of the role (lib/task-rules.ts): `servers:write` alone does not type in a console.
    mustAllow(principal, TASK_KIND_PERMISSION[task.kind], task.server.ownerId);

    const result = await toggleTaskOp(await actorOf(principal), task.id);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { task: task.id });
    const updated = await db.scheduledTask.findUniqueOrThrow({ where: { id: task.id }, include: { server: { select: { slug: true } } } });
    return ok({ ...taskShape(updated), message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
