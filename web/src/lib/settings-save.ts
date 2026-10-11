import "server-only";
import type { User } from "@prisma/client";
import { can } from "@/domain/access/permissions";
import type { ConfigValues } from "@/domain/games/config";
import { db } from "@/lib/db";
import { updateServerConfigOp, type ConfigResult } from "./config-ops";
import { updateServerSettingsOp, type OpResult } from "./server-ops";
import type { SettingsErrors, SettingsInput } from "./settings-rules";
import { rebuildServerOp } from "./update-ops";

/* The Settings page's one save: the game's settings and the server's own (name, address, limits, what happens when it stops), which used to
   be two forms with a button each, one at the top of the page and one at the bottom. A person who changed the MOTD and the CPU limit had to
   find both, and was not told.

   Both parts are checked before either is written, each by its own operation and with its own refusals, so a save that one part refuses
   writes nothing at all. Then the server's own settings are written first, so a rebuild the game's settings need is made with the new
   limits too, and the game's after. `rebuild` is the person having confirmed one: without it a game setting that needs the workload made
   again is refused, as it always was, and new resource limits are saved and left for a rebuild later; with it the workload is made again
   once, for whichever of the two asked for it. */

export interface SaveRequest {
  server?: SettingsInput;
  game?: ConfigValues;
  rebuild?: boolean;
}

export type SaveResult = OpResult & {
  /** Each refusal on the field it is about, by part. */
  errors?: { server?: SettingsErrors; game?: Record<string, string> };
  /** Refused because a game setting needs the server rebuilt, and no rebuild was asked for. */
  needsRebuild?: boolean;
  /** Something was written before a later step was refused. */
  saved?: boolean;
};

const nothingToSave = (r: OpResult | null) => r !== null && !r.ok && r.title === "Nothing to save";
const fieldErrors = (r: ConfigResult) => (r.problems?.length ? Object.fromEntries(r.problems.map((p) => [p.key, p.message])) : undefined);
// "2 changes saved." and "1 change written." from the two parts, said once for both.
const COUNT = /^\d+ changes? (saved|written)\.\s*/;

export async function saveSettingsOp(user: User, slug: string, request: SaveRequest): Promise<SaveResult> {
  const rebuild = request.rebuild === true;

  const [serverCheck, gameCheck] = await Promise.all([
    request.server ? updateServerSettingsOp(user, slug, request.server, { dryRun: true }) : Promise.resolve(null),
    request.game ? updateServerConfigOp(user, slug, request.game, { recreate: rebuild, dryRun: true }) : Promise.resolve(null),
  ]);
  // A part with nothing in it is not a part of this save.
  const server = nothingToSave(serverCheck) ? null : serverCheck;
  const game = nothingToSave(gameCheck) ? null : gameCheck;
  if (!server && !game) return { ok: false, title: "Nothing to save", body: "No values were changed." };

  const refused = [game, server].filter((r): r is NonNullable<typeof r> => r !== null && !r.ok);
  if (refused.length > 0) {
    return {
      ok: false,
      title: refused[0]!.title,
      body: [...new Set(refused.map((r) => r.body))].join(" "),
      errors: {
        server: server && !server.ok ? server.errors : undefined,
        game: game && !game.ok ? fieldErrors(game) : undefined,
      },
      needsRebuild: Boolean(game && !game.ok && game.plan?.needsRecreate && !rebuild && game.title === "This needs the server rebuilt"),
    };
  }

  const gameRebuilds = Boolean(game?.plan?.needsRecreate);
  const limitsRebuild = rebuild && Boolean(server?.rebuildRequired) && !gameRebuilds;
  if (limitsRebuild) {
    const row = await db.server.findUnique({ where: { slug }, select: { ownerId: true } });
    if (!row || !can(user, "server.update", row.ownerId)) {
      return {
        ok: false,
        title: "Cannot rebuild",
        body: "Only an owner or an admin can rebuild a server. Save without rebuilding, and the new limits wait for the next rebuild.",
      };
    }
  }

  const said: string[] = [];
  let changes = 0;
  let warn = false;
  let applied = false;

  if (server && request.server) {
    const r = await updateServerSettingsOp(user, slug, request.server, { rebuilding: limitsRebuild || gameRebuilds });
    // Refused between the check and the write (another save took the address): nothing has been written.
    if (!r.ok) return { ...r, errors: { server: r.errors } };
    warn ||= r.tone === "warning";
    changes += Number(COUNT.exec(r.body)?.[0].split(" ")[0] ?? 0);
    said.push(r.body.replace(COUNT, ""));
  }

  if (game && request.game) {
    const r = await updateServerConfigOp(user, slug, request.game, { recreate: rebuild });
    if (!r.ok) {
      return {
        ok: false,
        title: r.title,
        body: server ? `${r.body} The server's own settings above were saved.` : r.body,
        errors: { game: fieldErrors(r) },
        saved: Boolean(server),
      };
    }
    warn ||= r.tone === "warning";
    applied ||= gameRebuilds;
    changes += r.plan?.changes.length ?? 0;
    said.push(r.body.replace(COUNT, ""));
  }

  if (limitsRebuild) {
    const r = await rebuildServerOp(user, slug);
    if (!r.ok) {
      return { ok: false, title: r.title, body: `The settings were saved; the rebuild that gives the server its new limits did not happen. ${r.body}`, saved: true };
    }
    applied = true;
    said.push(r.body);
  }

  const counted = `${changes} change${changes === 1 ? "" : "s"} saved.`;
  return {
    ok: true,
    tone: warn || applied ? "warning" : "success",
    title: applied ? "Settings applied" : "Settings saved",
    body: [counted, ...said].map((s) => s.trim()).filter(Boolean).join(" "),
  };
}
