import { begin, fail, mustAllow, ok } from "@/lib/api";
import { rollbackServerOp } from "@/lib/update-ops";
import { actorOf, refusal, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/rollback

   Back to the version and the world the last update left behind, from
   the backup that update took. No body: there is only ever one way
   back, and the operation refuses when there is none. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.update", server.ownerId);

    const result = await rollbackServerOp(await actorOf(principal), server.slug);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { server: server.slug });
    return ok({ server: server.slug, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
