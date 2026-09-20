import Link from "next/link";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Card, Label, Meter } from "@/components/ui";
import { findGame } from "@/domain/games/registry";
import { ANALYTICS_RANGES, formatMinutes, type AnalyticsRange } from "@/lib/analytics-rules";
import { requireUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/queries";

export const dynamic = "force-dynamic";

const RANGE_LABEL: Record<AnalyticsRange, string> = { "24h": "24 h", "7d": "7 days", "30d": "30 days" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* Players and load across every server, from what the poller recorded.

   The design had retention cohorts, a trend against last month and a
   tick-rate panel. None of those is measured: no game reports its tick
   rate, and a cohort needs a player identity the console does not give.
   What is here is counted from join and leave lines and usage samples,
   and the page says which servers it could not count. */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const { range: requested } = await searchParams;
  const range: AnalyticsRange = requested && requested in ANALYTICS_RANGES ? (requested as AnalyticsRange) : "7d";
  const a = await getAnalytics(range);

  const uncounted = a.servers.filter((s) => !(s.gameId && findGame(s.gameId)?.console.players));
  const hasSamples = a.series.some((p) => p.players !== null);
  const maxHeat = Math.max(1, ...a.heatmap.flat());

  const time = (d: Date) =>
    range === "24h"
      ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  const kpis = [
    { label: "Unique players", value: String(a.uniquePlayers), sub: `${a.sessionCount} session${a.sessionCount === 1 ? "" : "s"}` },
    {
      label: "Median session",
      value: a.medianSessionMinutes === null ? "—" : formatMinutes(a.medianSessionMinutes),
      sub: "of sessions that ended",
    },
    { label: "Playtime", value: formatMinutes(a.playtimeMinutes), sub: "all players, all servers" },
    {
      label: "Peak online",
      value: a.peak ? String(a.peak.players) : "—",
      sub: a.peak ? `around ${time(a.peak.at)}${range === "24h" ? " UTC" : ""}` : "nobody seen online",
    },
  ];

  return (
    <AppShell crumbs={["Analytics"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Analytics</h1>
            <p className="mt-[7px] max-w-[72ch] text-[12.5px] leading-snug text-ink-3">
              Players and load across every server over the last {RANGE_LABEL[range]}, counted from
              join and leave lines in each console and from usage samples taken while servers run.
            </p>
          </div>
          <nav aria-label="Time range" className="inline-flex shrink-0 gap-px rounded-[9px] bg-(--border) p-px sm:ml-auto">
            {(Object.keys(ANALYTICS_RANGES) as AnalyticsRange[]).map((r) => (
              <Link
                key={r}
                href={r === "7d" ? "/analytics" : `/analytics?range=${r}`}
                aria-current={r === range ? "page" : undefined}
                className={`rounded-lg px-[14px] py-[7px] font-mono text-[11px] ${
                  r === range ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {r}
              </Link>
            ))}
          </nav>
        </div>

        {uncounted.length > 0 && (
          <p className="text-[11.5px] leading-snug text-ink-4">
            Players are not counted on {uncounted.map((s) => s.name).join(", ")} — {uncounted.length === 1 ? "its game does" : "their games do"} not
            report joins in the console.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label} className="p-5">
              <Label>{k.label}</Label>
              <div className="mt-3 text-[26px] leading-none font-semibold tracking-[-0.03em] tnum">{k.value}</div>
              <div className="mt-[10px] text-[11.5px] text-ink-4">{k.sub}</div>
            </Card>
          ))}
        </div>

        <Card className="p-5">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-[13.5px] font-semibold">Players online</h2>
            <span className="text-[11px] text-ink-4">highest count in each interval, added across servers</span>
          </div>
          {hasSamples ? <Concurrency series={a.series} label={time} utc={range === "24h"} /> : (
            <p className="py-8 text-center text-[12px] text-ink-4">
              No server was running in this window, so there is nothing to draw.
            </p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="p-5">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-[13.5px] font-semibold">Joins by hour</h2>
              <span className="font-mono text-[10.5px] text-ink-4">UTC</span>
            </div>
            {a.sessionCount === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-4">Nobody joined in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex min-w-[520px] flex-col gap-[3px]">
                  {a.heatmap.map((row, d) => (
                    <div key={DAYS[d]} className="flex items-center gap-2">
                      <span className="w-[26px] shrink-0 font-mono text-[9.5px] text-ink-4">{DAYS[d]}</span>
                      <div className="grid flex-1 grid-cols-24 gap-[3px]">
                        {row.map((n, h) => (
                          <div
                            key={h}
                            title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC — ${n} join${n === 1 ? "" : "s"}`}
                            className="aspect-square rounded-[3px]"
                            style={{
                              background: n === 0 ? "var(--card-2)" : `hsl(80 72% 60% / ${0.15 + (n / maxHeat) * 0.75})`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="w-[26px] shrink-0" />
                    <div className="grid flex-1 grid-cols-4 font-mono text-[9px] text-ink-4">
                      {["00", "06", "12", "18"].map((h) => (
                        <span key={h}>{h}:00</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[13.5px] font-semibold">Most playtime</h2>
            {a.top.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-4">No playtime recorded in this window.</p>
            ) : (
              a.top.map((p) => (
                <div key={p.username} className="flex items-center gap-[11px] py-[7px]">
                  <span className="w-[110px] shrink-0 truncate font-mono text-[11.5px]" title={p.servers.join(", ")}>
                    {p.username}
                  </span>
                  <span className="flex-1">
                    <Meter value={Math.round((p.minutes / a.top[0]!.minutes) * 100)} colour="var(--accent)" height={4} />
                  </span>
                  <span className="w-[72px] shrink-0 text-right font-mono text-[10.5px] text-ink-3">
                    {formatMinutes(p.minutes)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-baseline gap-3 border-b border-line px-[18px] py-[13px]">
            <h2 className="text-[13.5px] font-semibold">Load by server</h2>
            <span className="text-[11px] text-ink-4">while running · tick rate is not reported by any game yet</span>
          </div>
          {a.servers.length === 0 ? (
            <p className="px-[18px] py-6 text-[12px] text-ink-4">There are no servers yet.</p>
          ) : (
            a.servers.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-2 items-center gap-x-4 gap-y-2 border-b border-line px-[18px] py-[11px] last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_150px_110px]"
              >
                <Link href={`/servers/${s.slug}`} className="col-span-2 truncate text-[12.5px] font-medium hover:text-accent md:col-span-1">
                  {s.name}
                </Link>
                {s.usage ? (
                  <>
                    <span className="font-mono text-[10.5px] text-ink-3">
                      CPU avg {Math.round(s.usage.cpuAvg)}% · peak {s.usage.cpuMax}%
                    </span>
                    <span className="font-mono text-[10.5px] text-ink-3">
                      RAM avg {(s.usage.ramAvg / 1024).toFixed(1)} · peak {(s.usage.ramMax / 1024).toFixed(1)} / {s.memoryLimit} GB
                    </span>
                    <span className="font-mono text-[10.5px] text-ink-3">peak {s.usage.playersMax} online</span>
                  </>
                ) : (
                  <span className="text-[11px] text-ink-4 md:col-span-3">not running in this window</span>
                )}
              </div>
            ))
          )}
        </Card>
      </div>
    </AppShell>
  );
}

/* An area chart with a gap wherever no server was running, rather than
   a line drawn through zero that would read as "running, and empty". */
function Concurrency({
  series,
  label,
  utc,
}: {
  series: { at: Date; players: number | null }[];
  label: (d: Date) => string;
  utc: boolean;
}) {
  const W = 800;
  const H = 180;
  const max = Math.max(1, ...series.map((p) => p.players ?? 0));
  const x = (i: number) => ((i + 0.5) / series.length) * W;
  const y = (v: number) => H - (v / max) * (H - 12);

  const runs: { i: number; v: number }[][] = [];
  series.forEach((p, i) => {
    if (p.players === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1]!.i === i - 1) last.push({ i, v: p.players });
    else runs.push([{ i, v: p.players }]);
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.min(series.length - 1, Math.round(f * (series.length - 1))));

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex h-[180px] flex-col justify-between py-[2px] text-right font-mono text-[9.5px] text-ink-4">
          <span>{max}</span>
          <span>0</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[180px] w-full" role="img" aria-label="Players online over time">
          <defs>
            <linearGradient id="an-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="hsl(80 72% 60%)" stopOpacity="0.3" />
              <stop offset="1" stopColor="hsl(80 72% 60%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" />
          {runs.map((run) => {
            const line = run.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" L");
            const first = x(run[0]!.i).toFixed(1);
            const lastX = x(run[run.length - 1]!.i).toFixed(1);
            return (
              <g key={run[0]!.i}>
                <path d={`M${first},${H} L${line} L${lastX},${H} Z`} fill="url(#an-area)" />
                {run.length === 1 ? (
                  <circle cx={first} cy={y(run[0]!.v)} r="2.5" fill="hsl(80 72% 60%)" />
                ) : (
                  <path d={`M${line}`} fill="none" stroke="hsl(80 72% 60%)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex justify-between pl-6 font-mono text-[9.5px] text-ink-4">
        {ticks.map((i, n) => (
          <span key={n}>
            {label(series[i]!.at)}
            {utc && n === ticks.length - 1 ? " UTC" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
