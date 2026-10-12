import "server-only";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/domain/access/permissions";
import { gamesInFamily } from "@/domain/games/registry";
import type { GameDefinition } from "@/domain/games/types";
import { db } from "@/lib/db";
import { serversReadableBy } from "@/lib/queries";

/* Which servers are a game's, for "N hosted here" on its poster and the list on its page.

   By the catalog link, which is the game's id. The Games page used to count by family, so both Minecrafts said the same number: every
   Minecraft server, Java and Bedrock together. A server from before the catalog has only its family, and counts for a game when the family
   has no other game; an unlinked "Minecraft" is one of two, and neither is said for it.

   Only the servers the viewer may read: a member is told about the servers that are theirs, and not how many the workspace runs. */

/** The game a server is counted for, or null when its link and its family do not say. */
function gameOf(server: { gameId: string | null; game: string }): string | null {
  if (server.gameId) return server.gameId;
  const family = gamesInFamily(server.game);
  return family.length === 1 ? family[0]!.id : null;
}

export async function hostedCounts(viewer: Actor): Promise<Map<string, number>> {
  const rows = await db.server.groupBy({ by: ["gameId", "game"], where: serversReadableBy(viewer), _count: true });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = gameOf(row);
    if (id) counts.set(id, (counts.get(id) ?? 0) + row._count);
  }
  return counts;
}

export async function hostedServers(viewer: Actor, game: GameDefinition) {
  const theirs: Prisma.ServerWhereInput =
    gamesInFamily(game.family).length === 1 ? { OR: [{ gameId: game.id }, { gameId: null, game: game.family }] } : { gameId: game.id };
  return db.server.findMany({
    where: { AND: [serversReadableBy(viewer), theirs] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      host: true,
      port: true,
      version: true,
      state: true,
      node: { select: { name: true, state: true, lastReachedAt: true } },
    },
  });
}
