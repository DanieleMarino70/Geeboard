import { begin, fail, mustAllow, ok } from "@/lib/api";
import { runTaskNowOp } from "@/lib/server-ops";
import { actorOf, refusal, said } from "../../../_ops";
import { resolveTask } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/tasks/:id/run

   Runs the task now, as the scheduler would at its next time — a
   backup, a restart, a broadcast, a cleanup — and records the result on
   the task. Synchronous, and as long as the task takes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const task = await resolveTask(id);
    mustAllow(principal, "server.schedule.write", task.server.ownerId);

    const result = await runTaskNowOp(await actorOf(principal), task.id);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { task: task.id });
    return ok({ task: task.id, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
