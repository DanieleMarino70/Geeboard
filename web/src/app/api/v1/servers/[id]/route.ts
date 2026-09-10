import { findGame } from "@/domain/games/registry";
import { defaultsFor } from "@/domain/games/config";
import { outlookFor, resolveVersions } from "@/domain/games/versions";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { serverShape } from "../../_shape";
import { resolveServer } from "./_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id

   Includes the version outlook, which is the answer to "is there an
   update?" — and which needs all four meanings of latest to answer
   honestly. A game that has moved on past what Geeboard can install is
   not an available update, and saying so is the difference between a
   panel an operator trusts and one they learn to ignore. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.read", server.ownerId);

    const game = server.gameId ? findGame(server.gameId) : undefined;
    const versions = game ? await resolveVersions(game) : null;

    return ok({
      ...serverShape(server),
      settings: server.config ?? (game ? defaultsFor(game) : {}),
      /* The catalog row's slug is the version's id in the definition.
         Null on a server created before the catalog existed, which just
         means the outlook cannot say what is installed. */
      versionOutlook: versions ? outlookFor(versions, server.gameVersionRef?.slug ?? null) : null,
    });
  } catch (error) {
    return fail(error);
  }
}
