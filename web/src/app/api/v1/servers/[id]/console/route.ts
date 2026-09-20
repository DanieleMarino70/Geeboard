import { begin, fail, mustAllow, ok } from "@/lib/api";
import { sendConsoleCommandOp } from "@/lib/server-ops";
import { actorOf, jsonBody, refusal, required, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/console

   Body: `{ "command": "say hello" }`. One line, to the game's stdin,
   through the same operation as the console page — which refuses a
   game that reads nothing from its input, and records the command. The
   output is not returned: it arrives on the console stream and in
   `/logs`, as it does for a person. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 60);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.console.write", server.ownerId);

    const body = await jsonBody<{ command: string }>(req);
    const command = required(body, "command");

    const result = await sendConsoleCommandOp(await actorOf(principal), server.slug, command);
    if (!result.ok) refusal(result, "SERVER_STATE_INVALID", { server: server.slug });
    return ok({ server: server.slug, sent: command, message: said(result) }, 202);
  } catch (error) {
    return fail(error);
  }
}
