import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteTaskOp, updateTaskOp } from "@/lib/task-ops";
import { actorOf, jsonBody, refusal, said, taskInputOf } from "../../_ops";
import { taskShape } from "../../_shape";
import { resolveTask } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/tasks/:id */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const task = await resolveTask(id);
    mustAllow(principal, "server.read", task.server.ownerId);
    return ok(taskShape(task));
  } catch (error) {
    return fail(error);
  }
}

/* PATCH /api/v1/tasks/:id

   The whole task again — name, kind, cron, payload — as the scheduler's
   form saves it. Fields left out keep their value. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const task = await resolveTask(id);
    mustAllow(principal, "server.schedule.write", task.server.ownerId);

    const body = await jsonBody<Record<string, unknown>>(req);
    const input = taskInputOf({
      name: body.name ?? task.name,
      kind: body.kind ?? task.kind,
      cron: body.cron ?? task.cron,
      payload: body.payload ?? task.payload ?? "",
    });
    const result = await updateTaskOp(await actorOf(principal), task.id, input);
    if (!result.ok) refusal(result, "VALIDATION_FAILED", { errors: result.errors ?? null });

    const updated = await db.scheduledTask.findUniqueOrThrow({ where: { id: task.id }, include: { server: { select: { slug: true } } } });
    return ok({ ...taskShape(updated), message: said(result) });
  } catch (error) {
    return fail(error);
  }
}

/** DELETE /api/v1/tasks/:id */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const task = await resolveTask(id);
    mustAllow(principal, "server.schedule.write", task.server.ownerId);

    const result = await deleteTaskOp(await actorOf(principal), task.id);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { task: task.id });
    return ok({ task: task.id, deleted: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
