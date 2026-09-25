import { begin, fail, mustAllow, ok } from "@/lib/api";
import { refreshInstalledOp } from "@/lib/mod-ops";
import { actorOf, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";
import { modRefusal } from "../_mods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/mods/ask

   Ask the node, as the tab's button does: which of the list's downloads
   are on disk, and which mods are inside each — read from the files,
   never guessed. What this build loads of them is in GET /mods after. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const result = await refreshInstalledOp(await actorOf(principal), server.slug);
    if (!result.ok) modRefusal(result, "RUNTIME_REJECTED", { server: server.slug });
    return ok({ server: server.slug, found: result.found ?? 0, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
