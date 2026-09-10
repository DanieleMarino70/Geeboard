import { PlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/logs?tail=200

   Recent output, not a stream. Live output is the console endpoint,
   which is Server-Sent Events and belongs to the browser — a program
   that wants to tail a server should poll this or watch the console
   stream, not hold a socket open through the panel. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.console.read", server.ownerId);

    const node = runtimeFor(server.node);
    if (!node || !server.runtimeId) {
      throw new PlatformError(
        "RUNTIME_NOT_ATTACHED",
        `${server.node.name} has no agent attached, so there is no output to read.`,
        { details: { node: server.node.name } },
      );
    }

    const url = new URL(req.url);
    const tail = Math.min(2000, Math.max(1, Number(url.searchParams.get("tail") ?? 200) || 200));

    const lines = await node.logs({ serverId: server.id, runtimeId: server.runtimeId }, tail);
    return ok({ server: server.slug, tail, lines });
  } catch (error) {
    return fail(error);
  }
}
