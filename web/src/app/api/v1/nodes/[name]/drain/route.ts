import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { setNodeDrainOp } from "@/lib/server-ops";
import { actorOf, jsonBody, refusal, said } from "../../../_ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/:name/drain — body `{ "drain": true | false }`.

   Draining takes a node out of rotation for new placements and touches
   nothing already on it; false puts it back. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req, 60);
    mustAllow(principal, "node.manage");
    const { name } = await ctx.params;

    const body = await jsonBody<{ drain: unknown }>(req);
    if (typeof body.drain !== "boolean") throw new PlatformError("VALIDATION_FAILED", "drain has to be true or false.");

    const result = await setNodeDrainOp(await actorOf(principal), name, body.drain);
    if (!result.ok) refusal(result, /no longer exists|No node|unknown/i.test(result.body) ? "NODE_NOT_FOUND" : "CONFLICT", { node: name });
    return ok({ node: name, draining: body.drain, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
