import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { updateServerOp } from "@/lib/update-ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/servers/:id/update

   Body: `{ "versionId": "paper-1-21-4" }`. Synchronous, and it can take
   minutes: a backup of the whole world, an image pull and a restart.
   A client that cannot wait should poll the server instead of retrying,
   because a second update arriving mid-way through the first is the one
   thing this must not be asked to handle. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    // The tightest budget of any route: this is the most expensive
    // thing a caller can ask the platform to do.
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.update", server.ownerId);

    const body = (await req.json().catch(() => null)) as { versionId?: unknown } | null;
    if (typeof body?.versionId !== "string") {
      throw new PlatformError("VALIDATION_FAILED", "versionId is required.");
    }

    const user = await db.user.findUnique({ where: { id: principal.id } });
    if (!user) throw new PlatformError("UNAUTHENTICATED", "That account no longer exists.");

    const result = await updateServerOp(user, server.slug, body.versionId);
    if (!result.ok) {
      throw new PlatformError("SERVER_STATE_INVALID", `${result.title}. ${result.body}`, {
        details: { server: server.slug, versionId: body.versionId },
      });
    }

    return ok({ server: server.slug, message: `${result.title}. ${result.body}` }, 202);
  } catch (error) {
    return fail(error);
  }
}
