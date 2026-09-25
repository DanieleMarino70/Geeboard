import { begin, fail, mustAllow, ok } from "@/lib/api";
import { removeCollectionOp } from "@/lib/mod-ops";
import { actorOf, said } from "../../../../../_ops";
import { resolveServer } from "../../../_resolve";
import { modRefusal } from "../../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* DELETE /api/v1/servers/:id/mods/collections/:collectionId

   Every mod that collection added, and only those. A mod of it that
   came some other way stays. Applying the list takes them off the
   server. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; collectionId: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id, collectionId } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const result = await removeCollectionOp(await actorOf(principal), server.slug, collectionId);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug, collectionId });
    return ok({ server: server.slug, removed: result.removed ?? 0, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
