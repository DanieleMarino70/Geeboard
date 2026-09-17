import Link from "next/link";
import { Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { Card, Label } from "@/components/ui";
import { findGame } from "@/domain/games/registry";
import { requireUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { getPlayerSessions, getServers } from "@/lib/queries";

export const dynamic = "force-dynamic";

const COLS = "minmax(0,1fr) minmax(0,1fr) 120px 120px 84px";

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/* Who is on a server and who has been, from what its console said.

   The server page's Players tab used to go nowhere, and the dashboard's
   player count read "not read from any game yet". The poller now reads
   join and leave lines for games whose console says them; this is where
   they add up. */
export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const user = await requireUser();
  const { server: requested } = await searchParams;
  const servers = await getServers();
  const selected = servers.find((s) => s.slug === requested) ?? null;
  const { online, recent } = await getPlayerSessions(selected?.slug);

  const counted = servers.filter((s) => s.gameId && findGame(s.gameId)?.console.players);
  const uncounted = servers.filter((s) => !counted.includes(s));
  const selectedCounted = selected ? counted.includes(selected) : true;

  return (
    <AppShell
      crumbs={selected ? [{ label: selected.name, href: `/servers/${selected.slug}` }, "Players"] : ["Players"]}
      user={user}
    >
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Players</h1>
          <p className="mt-[7px] max-w-[72ch] text-[12.5px] leading-snug text-ink-3">
            Who is connected and who has played, read from each server&apos;s console as players join
            and leave. A player who joined before the panel was watching appears once they rejoin.
          </p>
        </div>

        {selected && <ServerTabs slug={selected.slug} active="players" />}
        <ServerSwitcher servers={servers} current={selected?.slug ?? null} basePath="/players" allLabel="All servers" />

        {servers.length === 0 ? (
          <Card className="p-6 text-[12.5px] text-ink-3">
            There are no servers yet.{" "}
            <Link href="/servers/new" className="text-accent hover:underline">
              Create one
            </Link>{" "}
            and its players appear here.
          </Card>
        ) : (
          <>
            {!selectedCounted && (
              <Card className="p-5 text-[12.5px] leading-relaxed text-ink-3">
                {selected?.game ?? "This game"} does not say in its console who joins and leaves, so
                Geeboard cannot count its players.
              </Card>
            )}
            {!selected && uncounted.length > 0 && (
              <p className="text-[11.5px] text-ink-4">
                Not counted — their games do not report joins: {uncounted.map((s) => s.name).join(", ")}.
              </p>
            )}

            {selectedCounted && (
              <>
                <Card className="overflow-hidden">
                  <div className="flex items-baseline gap-[10px] border-b border-line px-[18px] py-[13px]">
                    <h2 className="text-[13.5px] font-semibold">Online now</h2>
                    <span className="font-mono text-[10.5px] text-ink-4 tnum">{online.length}</span>
                  </div>
                  {online.length === 0 ? (
                    <div className="px-6 py-10 text-center">
                      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-[12px] border border-dashed border-line-2 text-ink-4">
                        <Users size={18} strokeWidth={1.6} />
                      </div>
                      <p className="text-xs text-ink-4">Nobody is connected.</p>
                    </div>
                  ) : (
                    online.map((p, i) => (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 px-[18px] py-[11px] ${i < online.length - 1 ? "border-b border-line" : ""}`}
                      >
                        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-success" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{p.username}</span>
                        {!selected && (
                          <Link href={`/servers/${p.server.slug}`} className="truncate text-[11.5px] text-ink-3 hover:text-accent">
                            {p.server.name}
                          </Link>
                        )}
                        <span className="w-[110px] text-right font-mono text-[10.5px] text-ink-4">
                          joined {timeAgo(p.joinedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </Card>

                <Card className="overflow-hidden">
                  <div className="flex items-baseline gap-[10px] border-b border-line px-[18px] py-[13px]">
                    <h2 className="text-[13.5px] font-semibold">Recent sessions</h2>
                    <span className="font-mono text-[10.5px] text-ink-4">last {recent.length}</span>
                  </div>
                  {recent.length === 0 ? (
                    <p className="px-6 py-10 text-center text-xs text-ink-4">No finished sessions yet.</p>
                  ) : (
                    <>
                      <div
                        className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                        style={{ gridTemplateColumns: COLS }}
                      >
                        {["Player", "Server", "Joined", "Left", "Played"].map((h) => (
                          <Label key={h}>{h}</Label>
                        ))}
                      </div>
                      {recent.map((p, i) => (
                        <div
                          key={p.id}
                          className={`grid grid-cols-2 items-center gap-x-[14px] gap-y-1 px-[18px] py-[11px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_120px_84px] ${
                            i < recent.length - 1 ? "border-b border-line" : ""
                          }`}
                        >
                          <span className="truncate font-mono text-[12px]">{p.username}</span>
                          <Link href={`/servers/${p.server.slug}`} className="truncate text-[11.5px] text-ink-3 hover:text-accent">
                            {p.server.name}
                          </Link>
                          <span className="font-mono text-[10.5px] text-ink-4">joined {timeAgo(p.joinedAt)}</span>
                          <span className="font-mono text-[10.5px] text-ink-4">{p.leftAt ? `left ${timeAgo(p.leftAt)}` : "—"}</span>
                          <span className="font-mono text-[10.5px] text-ink-3 tnum">{duration(p.playtimeM)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
