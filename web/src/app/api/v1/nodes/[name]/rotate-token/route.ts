import { begin, fail, mustAllow, ok } from "@/lib/api";
import { rotateAgentTokenOp } from "@/lib/node-ops";
import { actorOf, refusal, said } from "../../../_ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/:name/rotate-token

   A new agent token for a node in service. The panel makes it, hands it
   to the agent over the channel the old one authenticates, and stores it
   encrypted. It is not in the answer, and there is no route that returns
   one: `confirmed` says whether the agent has forgotten the old token. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req, 10);
    mustAllow(principal, "node.manage");
    const { name } = await ctx.params;

    const result = await rotateAgentTokenOp(await actorOf(principal), name);
    if (!result.ok) refusal(result, /no longer exists/i.test(result.body) ? "NODE_NOT_FOUND" : "CONFLICT", { node: name });
    return ok({ node: name, rotated: true, confirmed: result.tone === "success", message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
