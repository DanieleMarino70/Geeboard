import { allGames } from "@/domain/games/registry";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { gameShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/games — the catalog. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "game.read");
    return ok({ games: allGames().map(gameShape) });
  } catch (error) {
    return fail(error);
  }
}
