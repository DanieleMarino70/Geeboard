import { allows, begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { serverShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers

   Filterable by game family, node and state, because a client polling
   for "the servers that are down on this node" should not be handed
   every server and asked to sort it out. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "server.read");

    const url = new URL(req.url);
    const game = url.searchParams.get("game");
    const node = url.searchParams.get("node");
    const state = url.searchParams.get("state");

    const servers = await db.server.findMany({
      where: {
        ...(game ? { OR: [{ gameId: game }, { game }] } : {}),
        ...(node ? { node: { name: node } } : {}),
        ...(state ? { state: state.toUpperCase() as never } : {}),
      },
      orderBy: { name: "asc" },
      include: { node: { select: { name: true, region: true } } },
    });

    /* A read scoped to "own" is a filter, not a refusal — a member
       asking for the server list gets their servers, not a 403. */
    const visible = servers.filter((s) => allows(principal, "server.read", s.ownerId));
    return ok({ servers: visible.map(serverShape) });
  } catch (error) {
    return fail(error);
  }
}
