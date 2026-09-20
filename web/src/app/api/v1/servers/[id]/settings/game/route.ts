import { PlatformError } from "@/domain/errors";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { updateServerConfigOp } from "@/lib/config-ops";
import { actorOf, jsonBody, refusal, said } from "../../../../_ops";
import { resolveServer } from "../../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* PATCH /api/v1/servers/:id/settings/game

   Body: `{ "values": { "maxPlayers": 12, … }, "recreate": false }`. The
   game's own settings by domain key, the same operation the settings
   form saves through: a value that lives in a file is written to the
   node; one that is an environment variable needs the workload rebuilt,
   which is refused with a plan until `recreate` is sent as true. A
   setting fixed after creation is refused as the form refuses it. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<{ values: unknown; recreate: unknown }>(req);
    const values = body.values;
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new PlatformError("VALIDATION_FAILED", "values has to be an object of setting keys.");
    }
    for (const [key, value] of Object.entries(values)) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new PlatformError("VALIDATION_FAILED", `${key} has to be a string, a number or a boolean.`, { details: { field: key } });
      }
    }

    const result = await updateServerConfigOp(await actorOf(principal), server.slug, values as Record<string, string | number | boolean>, {
      recreate: body.recreate === true,
    });
    if (!result.ok) {
      /* The plan says what a rebuild would change, so a client can ask
         again with recreate: true, knowingly. */
      refusal(result, result.plan?.needsRecreate ? "CONFLICT" : "VALIDATION_FAILED", { plan: result.plan ?? null });
    }
    return ok({ server: server.slug, plan: result.plan ?? null, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
