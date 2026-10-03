import { requireGame } from "@/domain/games/registry";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { approvedRevisions } from "@/lib/community-games";
import { gameShape } from "../../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/games/:id */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "game.read");
    const { id } = await ctx.params;
    const game = requireGame(id);
    return ok(gameShape(game, (await approvedRevisions()).get(game.id)));
  } catch (error) {
    return fail(error);
  }
}
