import { begin, fail, mustAllow, ok } from "@/lib/api";
import { rejectNodeOp } from "@/lib/node-ops";
import { actorOf, refusal, said } from "../../../_ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/:name/reject

   Turns a node that registered and was never approved away: its row
   goes, and the name is free again. A node in service is not rejected;
   it is retired. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req, 60);
    mustAllow(principal, "node.manage");
    const { name } = await ctx.params;

    const result = await rejectNodeOp(await actorOf(principal), name);
    if (!result.ok) refusal(result, /no longer exists|No node|unknown/i.test(result.body) ? "NODE_NOT_FOUND" : "CONFLICT", { node: name });
    return ok({ node: name, rejected: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
