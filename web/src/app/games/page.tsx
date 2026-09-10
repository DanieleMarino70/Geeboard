import Link from "next/link";
import { ChevronRight, Cpu, HardDrive, MemoryStick } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Cover } from "@/components/ui";
import { CAPABILITY_LABELS } from "@/domain/games/types";
import { allGames } from "@/domain/games/registry";
import { storedCatalogs } from "@/lib/catalog-read";
import { requireUser } from "@/lib/auth";
import { formatReleased } from "@/lib/catalog";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/* The game catalog.

   One card per definition, and every fact on it comes from the
   definition rather than from this file — which is the test of whether
   the abstraction is real. Adding a game should light up a card here
   with no change to this page, and it does. */

const INSTALL_LABEL: Record<string, string> = {
  image: "Maintained build",
  steamcmd: "SteamCMD",
  download: "Direct download",
};

export default async function GamesPage() {
  const user = await requireUser();
  const games = allGames();

  /* How many servers of each family the workspace is already running.
     Grouped by family rather than by game id so a server created before
     the catalog existed still counts towards its game. */
  const running = await db.server.groupBy({ by: ["game"], _count: true });
  const counts = new Map(running.map((r) => [r.game, r._count]));

  /* From the catalog tables, not from upstream. Drawing this page must
     never depend on Steam being reachable — `npm run games:sync` is the
     one place that goes out to the network. */
  const catalogs = await storedCatalogs();

  return (
    <AppShell crumbs={["Ashfold", "Games"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Games</h1>
          <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
            What Geeboard knows how to host. Each game brings its own versions, settings, health
            checks and requirements — which is what lets the panel offer &ldquo;max players&rdquo;
            instead of an environment variable, and refuse a node that cannot run it.
          </p>
        </div>

        <span className="font-mono text-[10.5px] text-ink-4">
          {games.length} games ·{" "}
          {[...catalogs.values()].reduce((n, c) => n + c.candidates.length, 0)} versions
        </span>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {games.map((game) => {
            // storedCatalogs falls back to the definition for a game with
            // no rows, so every game has one; this is belt and braces.
            const catalog = catalogs.get(game.id) ?? { candidates: [], recommended: null, gameLatest: null, supportedLatest: null };
            const hosted = counts.get(game.family) ?? 0;

            return (
              <Card key={game.id} className="flex flex-col gap-[14px] p-[18px]">
                <div className="flex items-start gap-[14px]">
                  <Cover tag={game.art} size={52} radius={13} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[7px]">
                      <h2 className="truncate text-[14px] font-semibold">{game.name}</h2>
                      {game.official && <Badge>official</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-3">
                      {game.blurb}
                    </p>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-[7px] font-mono text-[10.5px]">
                  <div className="flex items-center gap-[6px] text-ink-3">
                    <MemoryStick size={12} strokeWidth={1.7} className="text-ink-4" />
                    <dd>{game.requirements.memoryGbMin} GB min</dd>
                  </div>
                  <div className="flex items-center gap-[6px] text-ink-3">
                    <Cpu size={12} strokeWidth={1.7} className="text-ink-4" />
                    <dd>{game.requirements.cpuPctMin / 100} cores min</dd>
                  </div>
                  <div className="flex items-center gap-[6px] text-ink-3">
                    <HardDrive size={12} strokeWidth={1.7} className="text-ink-4" />
                    <dd>{game.requirements.diskGbMin} GB min</dd>
                  </div>
                  <div className="text-ink-4">{INSTALL_LABEL[game.install.kind]}</div>
                </dl>

                <div className="flex flex-wrap gap-[5px]">
                  {game.requirements.capabilities.map((capability) => (
                    <Badge key={capability} tone="muted">
                      {CAPABILITY_LABELS[capability]}
                    </Badge>
                  ))}
                </div>

                <div className="rounded-[9px] border border-line bg-card-2 px-[11px] py-[9px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[9.5px] tracking-[0.04em] text-ink-4 uppercase">
                      Recommended
                    </span>
                    <span className="truncate text-[11.5px] font-medium">
                      {catalog.recommended?.label ?? "—"}
                    </span>
                  </div>
                  <div className="mt-[5px] flex items-baseline justify-between gap-3 font-mono text-[10px] text-ink-4">
                    <span>
                      {catalog.candidates.length} version
                      {catalog.candidates.length === 1 ? "" : "s"}
                    </span>
                    <span>
                      {catalog.recommended?.released
                        ? formatReleased(catalog.recommended.released)
                        : ""}
                    </span>
                  </div>
                  {/* The game moving ahead of what Geeboard can install is
                      worth saying out loud rather than showing as up to date. */}
                  {catalog.gameLatest &&
                    catalog.supportedLatest?.upstream &&
                    catalog.gameLatest !== catalog.supportedLatest.upstream && (
                      <div className="mt-[6px] font-mono text-[9.5px] text-warning">
                        game is on {catalog.gameLatest} · not yet supported
                      </div>
                    )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {hosted > 0 ? `${hosted} hosted here` : game.popularity}
                  </span>
                  <Link
                    href={`/servers/new?game=${game.id}`}
                    className="inline-flex items-center gap-[5px] text-[11.5px] font-medium text-accent hover:underline"
                  >
                    Host one
                    <ChevronRight size={13} strokeWidth={2} />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
