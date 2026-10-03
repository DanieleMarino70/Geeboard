import { allGames } from "@/domain/games/registry";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { approvedRevisions } from "@/lib/community-games";
import { gameShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/games — the catalog. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "game.read");
    const revisions = await approvedRevisions();
    return ok({ games: allGames().map((game) => gameShape(game, revisions.get(game.id))) });
  } catch (error) {
    return fail(error);
  }
}
