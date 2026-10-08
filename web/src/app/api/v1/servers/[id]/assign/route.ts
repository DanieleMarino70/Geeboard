import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { assignServerOp } from "@/lib/server-ops";
import { PlatformError } from "@/domain/errors";
import { actorOf, jsonBody, refusal, required, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/assign

   Body: `{ "member": "sam@example.com" }` — an email or an account id.
   Gives the server to that account, which is the only way a member
   comes to see one. Nothing on the node changes. Owners' and admins',
   under servers:manage. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id, principal);
    mustAllow(principal, "server.assign", server.ownerId);

    const body = await jsonBody<{ member: string }>(req);
    const who = required(body, "member").trim().toLowerCase();
    const member = await db.user.findFirst({ where: { OR: [{ email: who }, { id: body.member as string }] }, select: { id: true } });
    if (!member) throw new PlatformError("NOT_FOUND", "No account by that email or id.", { details: { member: who } });

    const result = await assignServerOp(await actorOf(principal), server.slug, member.id);
    if (!result.ok) refusal(result, "CONFLICT", { server: server.slug, member: who });
    return ok({ server: server.slug, member: who, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
