import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { addModOp, modsView } from "@/lib/mod-ops";
import { actorOf, jsonBody, required, said } from "../../../_ops";
import { resolveServer } from "../_resolve";
import { modRefusal, modsShape } from "./_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/mods

   The server's mod list as the Mods tab shows it: in load order, each
   with what the node found in its download and what this build loads
   of it, the collections the list came from, and whether the list has
   changed since it was last applied. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.read", server.ownerId);

    const view = await modsView(await actorOf(principal), server.slug);
    if (!view) throw new PlatformError("NOT_FOUND", "No server by that id.", { details: { server: id } });
    return ok(modsShape(server.slug, view));
  } catch (error) {
    return fail(error);
  }
}

/* POST /api/v1/servers/:id/mods

   Body: `{ "workshop": "3806120559" }` — an item's id, or its link.
   Chosen, not installed: it goes at the end of the list, and reaches
   the game when the list is applied. A collection is refused here and
   added through /mods/collections, as the tab does. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ workshop: string }>(req);
    const workshop = required(body, "workshop");

    const result = await addModOp(await actorOf(principal), server.slug, workshop);
    if (!result.ok) modRefusal(result, "VALIDATION_FAILED", { server: server.slug, workshop });
    return ok({ server: server.slug, message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
