import { begin, fail, mustAllow, ok } from "@/lib/api";
import { makeDirectoryOp } from "@/lib/file-ops";
import { actorOf, jsonBody, reachCode, refusal, required, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/files/directories — body `{ "path": "mods" }`. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.files.write", server.ownerId);

    const body = await jsonBody<{ path: string }>(req);
    const at = required(body, "path");
    const result = await makeDirectoryOp(await actorOf(principal), server.slug, at);
    if (!result.ok) refusal(result, reachCode(result.body), { path: at });
    return ok({ server: server.slug, path: at, message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
