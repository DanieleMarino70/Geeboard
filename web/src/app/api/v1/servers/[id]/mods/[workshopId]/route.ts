import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { removeModOp, setModEnabledOp } from "@/lib/mod-ops";
import { actorOf, jsonBody, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";
import { modRefusal } from "../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; workshopId: string }> };

/* PATCH /api/v1/servers/:id/mods/:workshopId

   Body: `{ "enabled": false }`. Switched off, a mod stays downloaded and
   leaves the load list when the list is next applied. */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const principal = await begin(req, 30);
    const { id, workshopId } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ enabled: boolean }>(req);
    if (typeof body.enabled !== "boolean") {
      throw new PlatformError("VALIDATION_FAILED", "enabled has to be true or false.", { details: { field: "enabled" } });
    }

    const result = await setModEnabledOp(await actorOf(principal), server.slug, workshopId, body.enabled);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug, workshopId });
    return ok({ server: server.slug, workshopId, enabled: body.enabled, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}

/* DELETE /api/v1/servers/:id/mods/:workshopId

   Off the list. Applying the list takes it off the server; what it
   added to the world stays in the world. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const principal = await begin(req, 30);
    const { id, workshopId } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const result = await removeModOp(await actorOf(principal), server.slug, workshopId);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug, workshopId });
    return ok({ server: server.slug, workshopId, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
