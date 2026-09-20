import { PlatformError } from "@/domain/errors";
import { configDrift, scopeToLine } from "@/domain/games/config";
import { findGame, versionOfServer } from "@/domain/games/registry";
import { begin, fail, mustAllow, ok } from "@/lib/api";
import { configOnNode, currentConfig } from "@/lib/config-ops";
import { updateServerSettingsOp } from "@/lib/server-ops";
import type { SettingsInput } from "@/lib/settings-rules";
import { actorOf, jsonBody, refusal, said } from "../../../_ops";
import { resolveServer } from "../_resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/servers/:id/settings

   Both halves of what the Settings page shows: the platform's settings
   (name, address, limits, restart policy) and the game's own, as the
   panel stored them and as the server's files hold them now — with the
   drift between the two named, since the file is what the game reads. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.read", server.ownerId);

    const definition = server.gameId ? findGame(server.gameId) : undefined;
    const game = definition
      ? scopeToLine(definition, versionOfServer(definition, { versionSlug: server.gameVersionRef?.slug, versionLabel: server.version })?.line)
      : undefined;
    const stored = game ? currentConfig(game, server) : {};
    const onNode = game ? await configOnNode(server, game) : { values: {}, read: false };

    return ok({
      server: server.slug,
      platform: {
        name: server.name,
        host: server.host,
        memoryLimit: server.memoryLimit,
        cpuLimit: server.cpuLimit,
        restartPolicy: server.restartPolicy,
        maxRestarts: server.maxRestarts,
      },
      game: game
        ? {
            fields: game.config.map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              default: f.default,
              options: f.options ?? null,
              restartRequired: f.restartRequired === true,
              fixedAfterCreation: f.fixedAfterCreation === true,
            })),
            stored,
            onServer: onNode.read ? onNode.values : null,
            drift: configDrift(game, stored, onNode.values),
          }
        : null,
    });
  } catch (error) {
    return fail(error);
  }
}

const POLICIES = new Set(["NEVER", "ON_FAILURE", "ALWAYS"]);

/* PATCH /api/v1/servers/:id/settings

   Any of the platform settings; what is not sent keeps its value. New
   resource limits are recorded and take effect at the next rebuild, as
   the page says. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req, 30);
    const { id } = await ctx.params;
    const server = await resolveServer(id);
    mustAllow(principal, "server.settings.write", server.ownerId);

    const body = await jsonBody<Record<string, unknown>>(req);
    const text = (field: "name" | "host") => {
      const value = body[field];
      if (value === undefined) return server[field];
      if (typeof value !== "string") throw new PlatformError("VALIDATION_FAILED", `${field} has to be text.`, { details: { field } });
      return value;
    };
    const number = (field: "memoryLimit" | "cpuLimit" | "maxRestarts") => {
      const value = body[field];
      if (value === undefined) return server[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new PlatformError("VALIDATION_FAILED", `${field} has to be a number.`, { details: { field } });
      }
      return value;
    };
    const policy = body.restartPolicy ?? server.restartPolicy;
    if (typeof policy !== "string" || !POLICIES.has(policy)) {
      throw new PlatformError("VALIDATION_FAILED", "restartPolicy has to be NEVER, ON_FAILURE or ALWAYS.");
    }

    const input: SettingsInput = {
      name: text("name"),
      host: text("host"),
      memoryLimit: number("memoryLimit"),
      cpuLimit: number("cpuLimit"),
      restartPolicy: policy as SettingsInput["restartPolicy"],
      maxRestarts: number("maxRestarts"),
    };

    const result = await updateServerSettingsOp(await actorOf(principal), server.slug, input);
    if (!result.ok) refusal(result, "VALIDATION_FAILED", { errors: result.errors ?? null });
    return ok({ server: server.slug, rebuildRequired: result.rebuildRequired === true, message: said(result) });
  } catch (error) {
    return fail(error);
  }
}
