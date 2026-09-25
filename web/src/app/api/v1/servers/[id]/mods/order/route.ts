import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { reorderModsOp } from "@/lib/mod-ops";
import { actorOf, jsonBody, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";
import { modRefusal } from "../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* PUT /api/v1/servers/:id/mods/order

   Body: `{ "order": ["2392709985", "2169435993", …] }` — every Workshop
   id on the list, once, in the order to load them. The last one wins a
   conflict. A list that is not exactly the server's is refused rather
   than guessed at. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ order: string[] }>(req);
    const order = body.order;
    if (!Array.isArray(order) || !order.every((value) => typeof value === "string")) {
      throw new PlatformError("VALIDATION_FAILED", "order has to be a list of Workshop ids.", { details: { field: "order" } });
    }

    const result = await reorderModsOp(await actorOf(principal), server.slug, order);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug });
    return ok({ server: server.slug, order, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
