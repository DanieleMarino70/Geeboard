import { begin, fail, mustAllow, ok } from "@/lib/api";
import { moveServerOp } from "@/lib/move-ops";
import { actorOf, jsonBody, refusal, required, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/move

   Body: `{ "node": "fra-node-02" }`. Through the off-site bucket, with
   the checks and the rollback the Settings page's move has — see
   docs/nodes.md. Synchronous, and as long as a backup, an upload and a
   download of the world. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    // Placing a server elsewhere commits a node's resources, like creating one.
    mustAllow(principal, "server.create", server.ownerId);

    const body = await jsonBody<{ node: string }>(req);
    const node = required(body, "node");

    const result = await moveServerOp(await actorOf(principal), server.slug, node);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { server: server.slug, node });
    return ok({ server: server.slug, node, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
