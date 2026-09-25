import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { applyModsOp } from "@/lib/mod-ops";
import { actorOf, jsonBody, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";
import { modRefusal } from "../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/mods/apply

   Body, optional: `{ "backup": false }`. Writes the list into the game's
   settings — the one mod operation that touches the node — after a
   backup of a running server, unless told not to, as the tab asks. The
   game downloads and loads it on its next start; nothing here restarts
   it. Refused while the game is still starting, because it rewrites its
   settings once its mods are in and would undo this. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ backup: boolean }>(req);
    if (body.backup !== undefined && typeof body.backup !== "boolean") {
      throw new PlatformError("VALIDATION_FAILED", "backup has to be true or false.", { details: { field: "backup" } });
    }

    const result = await applyModsOp(await actorOf(principal), server.slug, { backup: body.backup });
    if (!result.ok) modRefusal(result, "SERVER_STATE_INVALID", { server: server.slug });
    return ok({ server: server.slug, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
