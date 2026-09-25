import "server-only";
import type { ErrorCode } from "@/domain/errors";
import type { ModsView } from "@/lib/mod-ops";
import type { OpResult } from "@/lib/server-ops";
import { refusal } from "../../../_ops";

/* The Mods tab's operations, as the API answers them.

   Every route here is the tab's own operation from lib/mod-ops.ts, so
   the API can do exactly what the tab can and nothing it cannot. What
   is added is the code a program switches on: the operations refuse
   with a sentence for a person, and which sentence it is decides the
   code. The words stay the operation's. */

const CODES: Array<[RegExp, ErrorCode]> = [
  [/^(Not on this server|Nothing from that collection|Cannot do that|Steam does not know that item)$/, "NOT_FOUND"],
  [/^(Already on this server|Nothing new)$/, "CONFLICT"],
  [/^Steam refused the key$/, "MOD_KEY_REFUSED"],
  [/^Could not ask Steam$/, "MOD_PROVIDER_FAILED"],
  [/^No agent on this node$/, "RUNTIME_NOT_ATTACHED"],
  [/^Upgrade the agent first$/, "NODE_INCOMPATIBLE"],
  [/^(Could not ask the node|Could not write the mod list)$/, "RUNTIME_REJECTED"],
];

/** A refused mod operation as an error, under the code its sentence belongs to. */
export function modRefusal(result: Extract<OpResult, { ok: false }>, fallback: ErrorCode, details?: Record<string, unknown>): never {
  const code = CODES.find(([pattern]) => pattern.test(result.title))?.[1] ?? fallback;
  refusal(result, code, details);
}

/** The list as a client reads it: the tab's view without what only a page needs. */
export function modsShape(slug: string, view: ModsView) {
  return {
    server: slug,
    game: view.game,
    // False for a game whose mods the panel does not install; the list is then empty.
    supported: view.support !== null,
    build: view.build,
    attached: view.attached,
    pending: view.pending,
    awaitingDownload: view.awaitingDownload,
    refused: view.refused,
    collections: view.collections,
    mods: view.mods.map((mod) => ({
      workshopId: mod.workshopId,
      title: mod.title,
      enabled: mod.enabled,
      position: mod.position,
      downloaded: mod.downloaded,
      modIds: mod.modIds,
      loads: mod.loads,
      refused: mod.refused,
      pulledInBy: mod.pulledInBy,
      collection: mod.collection,
      // What its Workshop page requires that the list lacks; null without a Steam key.
      missing: mod.missing,
      sizeBytes: mod.sizeBytes,
      addedBy: mod.addedBy,
      addedAt: mod.addedAt,
    })),
  };
}
