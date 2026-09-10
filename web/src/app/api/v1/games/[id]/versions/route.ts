import { requireGame } from "@/domain/games/registry";
import { resolveVersions } from "@/domain/games/versions";
import { begin, fail, mustAllow, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* GET /api/v1/games/:id/versions

   The several meanings of "latest" are all here, separately, because
   they are routinely different numbers and a client that has to guess
   which one it is holding will guess wrong. `providerErrors` is
   reported rather than swallowed: a stale list is usable, a silently
   stale one is not. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await begin(req);
    mustAllow(principal, "game.read");

    const { id } = await ctx.params;
    const catalog = await resolveVersions(requireGame(id));

    return ok({
      gameId: catalog.gameId,
      latest: {
        game: catalog.gameLatest,
        server: catalog.serverLatest,
        supported: catalog.supportedLatest?.upstream ?? null,
      },
      recommended: catalog.recommended?.id ?? null,
      versions: catalog.candidates.map((v) => ({
        id: v.id,
        label: v.label,
        upstream: v.upstream ?? null,
        channel: v.channel,
        supported: v.supported,
        recommended: v.id === catalog.recommended?.id,
        released: v.released ?? null,
        note: v.note ?? null,
        source: v.providerId,
      })),
      providerErrors: catalog.providerErrors,
    });
  } catch (error) {
    return fail(error);
  }
}
