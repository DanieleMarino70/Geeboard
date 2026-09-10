import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { nodeShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/nodes — the machines registered with this panel. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "node.read");

    const nodes = await db.node.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { servers: true } } },
    });

    return ok({ nodes: nodes.map((n) => nodeShape(n, { servers: n._count.servers })) });
  } catch (error) {
    return fail(error);
  }
}
