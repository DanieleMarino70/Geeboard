import Link from "next/link";
import { Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { LinkButton } from "@/components/ui";
import { POSTER_FRAME, PosterBody, posterIds } from "@/components/poster";
import { holds } from "@/domain/access/permissions";
import { allGames, isCommunityId } from "@/domain/games/registry";
import { storedCatalogs } from "@/lib/catalog-read";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { postersFor } from "@/lib/game-posters";
import { hostedCounts } from "./hosted";

export const dynamic = "force-dynamic";

/* The game catalog: a wall of posters, one per definition, each a link to the game's own page (games/[id]), where what used to be
   on the card is — requirements, versions, templates, the servers it runs here.

   Every fact on a poster comes from the definition rather than from this file, which is the test of whether the abstraction is real:
   adding a game puts a poster here with no change to this page, and a community game an owner approved is here beside the ones
   Geeboard ships, with its badge. */

export const metadata = { title: "Games" };

/* Two abreast on a phone, three or four on a tablet (beside the rail from 768, four once there is room for them at 900), four beside the
   full sidebar from 1024, five from 1280 and six from 1536. */
const GRID = "grid grid-cols-2 gap-3 md:grid-cols-3 min-[900px]:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export default async function GamesPage() {
  const user = await requireUser();
  const games = allGames();
  const mayPropose = holds(user.role, "community.propose");

  /* From the catalog tables and the panel's own storage, not from upstream. Drawing this page must never depend on Steam being
     reachable — `npm run games:sync` and the poller are what go out to the network. */
  const [waiting, hosted, catalogs, posters] = await Promise.all([
    mayPropose ? db.gameManifest.count({ where: { state: "PENDING" } }) : 0,
    hostedCounts(user),
    storedCatalogs(),
    postersFor(games.map((game) => game.id)),
  ]);

  return (
    <AppShell crumbs={["Games"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Games</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              What Geeboard knows how to host. Each game brings its own versions, settings, health
              checks and requirements — which is what lets the panel offer &ldquo;max players&rdquo;
              instead of an environment variable, and refuse a node that cannot run it.
            </p>
          </div>
          {mayPropose && (
            <LinkButton href="/games/community" intent="secondary" icon={Users}>
              Community games{waiting > 0 ? ` · ${waiting} waiting` : ""}
            </LinkButton>
          )}
        </div>

        <span className="font-mono text-[10.5px] text-ink-4">
          {games.length} games ·{" "}
          {[...catalogs.values()].reduce((n, c) => n + c.candidates.length, 0)} versions
        </span>

        <ul role="list" className={GRID}>
          {games.map((game) => {
            // storedCatalogs falls back to the definition for a game with no rows, so every game has one; this is belt and braces.
            const catalog = catalogs.get(game.id);
            const versions = catalog?.candidates.length ?? 0;
            const count = hosted.get(game.id) ?? 0;
            const face = { id: game.id, name: game.name, art: game.art, official: game.official, community: isCommunityId(game.id) };
            const ids = posterIds(`poster-${game.id}`, face);

            return (
              <li key={game.id}>
                <Link href={`/games/${game.id}`} aria-labelledby={ids.labelledBy} aria-describedby={ids.details} className={POSTER_FRAME}>
                  <PosterBody
                    game={face}
                    poster={posters.get(game.id)}
                    base={`poster-${game.id}`}
                    heading
                    line={count > 0 ? `${count} hosted here` : "None hosted here"}
                    details={
                      <>
                        <p className="line-clamp-3 md:line-clamp-4">{game.blurb}</p>
                        <p className="font-mono text-[10px]">
                          At least {game.requirements.memoryGbMin} GB RAM · {game.requirements.cpuPctMin / 100} core
                          {game.requirements.cpuPctMin === 100 ? "" : "s"} · {game.requirements.diskGbMin} GB disk.
                        </p>
                        <p className="font-mono text-[10px]">
                          {versions} version{versions === 1 ? "" : "s"}
                          {catalog?.recommended ? ` · ${catalog.recommended.label} recommended` : ""}.
                        </p>
                      </>
                    }
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}
