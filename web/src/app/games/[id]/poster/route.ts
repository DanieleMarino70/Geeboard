import { getCurrentUser } from "@/lib/auth";
import { posterResponse } from "@/lib/game-posters";

/* A game's poster, as the panel stored it (lib/game-posters.ts says what is served, to whom, and how it is cached).

   Beside the pages and not under /api/v1: it is what an <img> on a page asks for, with the page's session, and the frozen API gains
   nothing by it. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return posterResponse(req, id, await getCurrentUser());
}
