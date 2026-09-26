import { findGame } from "@/domain/games/registry";
import { defaultsFor, secretKeys, withoutSecrets, type ConfigValues } from "@/domain/games/config";
import { outlookFor } from "@/domain/games/versions";
import { storedCatalog } from "@/lib/catalog-read";
import { allows, begin, fail, mustAllow, ok } from "@/lib/api";
import { deleteServerOp } from "@/lib/server-ops";
import { actorOf, jsonBody, refusal, required, said } from "../../_ops";
import { serverShape } from "../../_shape";
import { resolveServer } from "./_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id

   Includes the version outlook, which is the answer to "is there an
   update?" — and which needs all four meanings of latest to answer
   honestly. A game that has moved on past what Geeboard can install is
   not an available update, and saying so is the difference between a
   panel an operator trusts and one they learn to ignore. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.read", server.ownerId);

    const game = server.gameId ? findGame(server.gameId) : undefined;
    const versions = game ? await storedCatalog(game.id) : null;
    const settings = (server.config as ConfigValues | null) ?? (game ? defaultsFor(game) : {});
    // A join password only for a caller who could change it; see the settings route.
    const hides = game && !allows(principal, "server.settings.write", server.ownerId) ? game : null;

    return ok({
      ...serverShape(server),
      settings: hides ? withoutSecrets(hides, settings) : settings,
      hiddenSettings: hides ? secretKeys(hides) : [],
      /* The catalog row's slug is the version's id in the definition.
         Null on a server created before the catalog existed, which just
         means the outlook cannot say what is installed. */
      versionOutlook: versions
        ? outlookFor(versions, {
            versionId: server.gameVersionRef?.slug ?? null,
            buildId: server.installedBuildId,
          })
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

/* DELETE /api/v1/servers/:id

   Body: `{ "confirm": "<the server's name>", "finalBackup": true }` — the
   same typed name the Danger zone asks for, because a delete removes the
   workload, the world and the backups on the node, and a client should
   have to say which one it means in the words a person would.

   `finalBackup` is the Danger zone's checkbox: one more backup, off-site,
   before anything is removed. If it cannot be taken nothing is deleted.
   Off by default here — a script says what it wants. Off-site backups
   outlive the server either way: `GET /backups?deleted=true`. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 10);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.delete", server.ownerId);

    const body = await jsonBody<{ confirm: string; finalBackup?: unknown }>(req);
    const confirm = required(body, "confirm");

    const result = await deleteServerOp(await actorOf(principal), server.slug, confirm, {
      finalBackup: body.finalBackup === true,
    });
    if (!result.ok) refusal(result, result.title === "Name does not match" ? "VALIDATION_FAILED" : "SERVER_STATE_INVALID", { server: server.slug });
    return ok({ server: server.slug, deleted: true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
