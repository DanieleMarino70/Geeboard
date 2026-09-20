import { PlatformError } from "@/domain/errors";
import { capacityOf } from "@/lib/create-ops";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { removeNodeOp } from "@/lib/node-ops";
import { actorOf, jsonBody, refusal, required, said } from "../../_ops";
import { nodeShape } from "../../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/nodes/:name

   Committed figures alongside the live ones. A node reporting 20% CPU
   with every core already promised to a server is full, and only one of
   those two numbers says so. */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "node.read");

    const { name } = await ctx.params;
    const node = await db.node.findUnique({
      where: { name },
      include: { _count: { select: { servers: true } } },
    });
    if (!node) {
      throw new PlatformError("NODE_NOT_FOUND", "No node by that name.", { details: { name } });
    }

    const committed = await capacityOf(node.id);

    return ok({
      ...nodeShape(node, { servers: node._count.servers }),
      committed: {
        cpuPct: committed.cpuCommitted,
        cpuTotalPct: node.cpuCores * 100,
        ramGb: committed.ramCommitted,
        ramTotalGb: node.ramTotal,
        diskGb: committed.diskCommitted,
        diskTotalGb: node.diskTotal,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

/* DELETE /api/v1/nodes/:name

   Body: `{ "confirm": "<the node's name>" }`. The retirement checklist
   as a request: refused while the node still hosts servers or is in
   rotation, in the same words the node's page uses. Removing never
   touches the machine — see docs/nodes.md. */
export async function DELETE(req: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const principal = await begin(req, 30);
    mustAllow(principal, "node.manage");
    const { name } = await ctx.params;

    const body = await jsonBody<{ confirm: string }>(req);
    const confirm = required(body, "confirm");

    const result = await removeNodeOp(await actorOf(principal), name, confirm);
    if (!result.ok) refusal(result, /no longer exists|No node/i.test(result.body) ? "NODE_NOT_FOUND" : "CONFLICT", { node: name });
    return ok({ node: name, removed: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
