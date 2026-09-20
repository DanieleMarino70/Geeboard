import { begin, fail, mustAllow, ok } from "@/lib/api";
import { approveNodeOp } from "@/lib/node-ops";
import { actorOf, refusal, said } from "../../../_ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/:name/approve

   Puts a registered node in service. Approval is the control that
   matters: until it, a node that registered takes no servers. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req, 60);
    mustAllow(principal, "node.manage");
    const { name } = await ctx.params;

    const result = await approveNodeOp(await actorOf(principal), name);
    if (!result.ok) refusal(result, /no longer exists|No node|unknown/i.test(result.body) ? "NODE_NOT_FOUND" : "CONFLICT", { node: name });
    return ok({ node: name, approved: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
