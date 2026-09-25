import { begin, fail, mustAllow, ok } from "@/lib/api";
import { addCollectionOp } from "@/lib/mod-ops";
import { actorOf, jsonBody, required, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";
import { modRefusal } from "../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/mods/collections

   Body: `{ "collection": "3806120559" }` — its id, or its link. Every
   item in it the game can load and the server does not have goes at the
   end of the list in the collection's order, remembered as this
   collection's. Collections it links are followed, as on the tab. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ collection: string }>(req);
    const collection = required(body, "collection");

    const result = await addCollectionOp(await actorOf(principal), server.slug, collection);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug, collection });
    return ok({ server: server.slug, added: result.added ?? 0, message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
