import { PlatformError } from "@/domain/errors";
import { allows, begin, fail, mustAllow, ok } from "@/lib/api";
import { createServerOp, type CreateInput } from "@/lib/create-ops";
import { db } from "@/lib/db";
import { actorOf, jsonBody, refusal, required, said } from "../_ops";
import { serverShape } from "../_shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers

   Filterable by game family, node and state, because a client polling
   for "the servers that are down on this node" should not be handed
   every server and asked to sort it out. */
export async function GET(req: Request) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "server.read");

    const url = new URL(req.url);
    const game = url.searchParams.get("game");
    const node = url.searchParams.get("node");
    const state = url.searchParams.get("state");

    const servers = await db.server.findMany({
      where: {
        ...(game ? { OR: [{ gameId: game }, { game }] } : {}),
        ...(node ? { node: { name: node } } : {}),
        ...(state ? { state: state.toUpperCase() as never } : {}),
      },
      orderBy: { name: "asc" },
      include: { node: { select: { name: true, region: true } } },
    });

    /* A read scoped to "own" is a filter, not a refusal — a member
       asking for the server list gets their servers, not a 403. */
    const visible = servers.filter((s) => allows(principal, "server.read", s.ownerId));
    return ok({ servers: visible.map(serverShape) });
  } catch (error) {
    return fail(error);
  }
}

/* POST /api/v1/servers

   Body: name, host, gameId, versionId, templateId, nodeName, memoryGb,
   cpuLimit, diskGb, and an optional `settings` object of the game's own
   settings over the template — the wizard's form, as JSON. Synchronous:
   the node provisions and starts the server before this answers, which
   is how the wizard works and what a client polling `state` expects.
   The same operation as the wizard, refusals included. */
export async function POST(req: Request) {
  try {
    // Creating commits a node's resources; the budget is the update's.
    const principal = await begin(req, 10);
    mustAllow(principal, "server.create");
    const body = await jsonBody<Record<string, unknown>>(req);

    const numbers = (field: string) => {
      const value = body[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new PlatformError("VALIDATION_FAILED", `${field} has to be a number.`, { details: { field } });
      }
      return value;
    };
    const settings = body.settings;
    if (settings !== undefined && (typeof settings !== "object" || settings === null || Array.isArray(settings))) {
      throw new PlatformError("VALIDATION_FAILED", "settings has to be an object of the game's setting keys.");
    }

    const input: CreateInput = {
      name: required(body, "name"),
      host: required(body, "host"),
      gameId: required(body, "gameId"),
      versionId: required(body, "versionId"),
      templateId: required(body, "templateId"),
      nodeName: required(body, "nodeName"),
      memoryGb: numbers("memoryGb"),
      cpuLimit: numbers("cpuLimit"),
      diskGb: numbers("diskGb"),
      ...(settings ? { config: settings as CreateInput["config"] } : {}),
      /* Deliberate overcommit of memory and CPU, the same decision the
         wizard's checkbox is. Anything but `true` is no. */
      ...(body.overcommit === true ? { overcommit: true } : {}),
    };

    const result = await createServerOp(await actorOf(principal), input);
    if (!result.ok) refusal(result, "VALIDATION_FAILED", { input: { ...input, config: undefined } });

    const server = await db.server.findUniqueOrThrow({
      where: { slug: result.slug! },
      include: { node: { select: { name: true, region: true } } },
    });
    return ok({ ...serverShape(server), message: said(result) }, 201);
  } catch (error) {
    return fail(error);
  }
}
