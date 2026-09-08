import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Archive,
  Clock,
  Cpu,
  Globe,
  RotateCw,
  Square,
  Terminal,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { Button, Card, Cover, Pill } from "@/components/ui";
import {
  BACKUPS,
  CONSOLE_LOG,
  LOG_COLOUR,
  ONLINE_PLAYERS,
  SERVERS,
  STATE_TONE,
  getServer,
} from "@/lib/mock";

export function generateStaticParams() {
  return SERVERS.map((s) => ({ id: s.id }));
}

const TABS = ["Overview", "Console", "Files", "Backups", "Scheduler", "Players", "Plugins", "Settings"];

/* One hour of CPU and memory, plotted in a 600×170 viewBox. */
const CPU_POINTS =
  "0,120 40,108 80,116 120,86 160,94 200,70 240,78 280,52 320,64 360,44 400,56 440,38 480,48 520,30 560,40 600,34";
const RAM_POINTS =
  "0,96 40,92 80,88 120,84 160,86 200,78 240,80 280,72 320,74 360,66 400,68 440,60 480,62 520,56 560,58 600,54";

export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const server = getServer(id);
  if (!server) notFound();

  const state = STATE_TONE[server.state];
  const facts = [
    ["Node", server.node, "Frankfurt · 14 ms"],
    ["Address", server.address.split(":")[0], `port ${server.address.split(":")[1]}`],
    ["Version", server.version, "build 218"],
    ["Uptime", server.uptime, "since 2 Sep, 09:12"],
  ] as const;

  return (
    <AppShell crumbs={["Ashfold", "Servers", server.name]}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <Cover tag={server.art} size={52} radius={13} />
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h1 className="text-[clamp(22px,2.8vw,26px)] font-semibold tracking-[-0.025em]">
                {server.name}
              </h1>
              <Pill tone={state.tone} pulse={state.pulse}>
                {state.label}
              </Pill>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-[14px] gap-y-2 font-mono text-[11px] text-ink-4">
              <span className="flex items-center gap-[6px]">
                <Globe size={13} strokeWidth={1.7} />
                {server.address}
              </span>
              <span className="flex items-center gap-[6px]">
                <Cpu size={13} strokeWidth={1.7} />
                {server.node}
              </span>
              <span className="flex items-center gap-[6px]">
                <Clock size={13} strokeWidth={1.7} />
                up {server.uptime}
              </span>
              <span className="flex items-center gap-[6px]">
                <Users size={13} strokeWidth={1.7} />
                {server.players.online} / {server.players.max} online
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
            <Button intent="secondary" icon={RotateCw}>
              Restart
            </Button>
            <Button intent="destructive" icon={Square}>
              Stop
            </Button>
            <Button icon={Archive}>Back up now</Button>
          </div>
        </div>

        <div
          role="tablist"
          className="-mx-5 flex gap-[2px] overflow-x-auto border-b border-line px-5 sm:-mx-8 sm:px-8"
        >
          {TABS.map((t, i) => {
            const on = i === 0;
            const href = t === "Console" ? `/console?server=${server.id}` : undefined;
            const inner = (
              <>
                {t}
                <span
                  className={`absolute inset-x-2 -bottom-px h-[2px] rounded-[2px] ${on ? "bg-accent" : "bg-transparent"}`}
                />
              </>
            );
            const cls = `relative shrink-0 px-[15px] pt-[11px] pb-[13px] text-[12.5px] transition-colors duration-150 ${
              on ? "font-medium text-ink" : "text-ink-3 hover:text-ink-2"
            }`;
            return href ? (
              <Link key={t} href={href} className={cls}>
                {inner}
              </Link>
            ) : (
              <button key={t} type="button" role="tab" aria-selected={on} className={cls}>
                {inner}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col p-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-[13.5px] font-semibold">Resource usage</h2>
                <div className="ml-auto flex flex-wrap items-center gap-[14px]">
                  <span className="flex items-center gap-[6px] font-mono text-[10px] text-ink-3">
                    <span className="h-[2px] w-2 rounded-[2px] bg-accent" />
                    CPU {server.cpu}%
                  </span>
                  <span className="flex items-center gap-[6px] font-mono text-[10px] text-ink-3">
                    <span className="h-[2px] w-2 rounded-[2px] bg-info" />
                    Memory 5.0 GB
                  </span>
                  <div className="inline-flex gap-px rounded-lg bg-(--border) p-px">
                    {["1h", "6h", "24h", "7d"].map((t, i) => (
                      <button
                        key={t}
                        type="button"
                        className={`rounded-[7px] px-[10px] py-1 font-mono text-[10px] transition-colors duration-150 ${
                          i === 0 ? "bg-card-2 text-ink" : "text-ink-4 hover:text-ink-2"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 h-[200px]">
                <svg
                  viewBox="0 0 600 170"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="CPU and memory over the last hour"
                  className="block h-full w-full"
                >
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="hsl(80 72% 60%)" stopOpacity="0.22" />
                      <stop offset="1" stopColor="hsl(80 72% 60%)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[34, 68, 102, 136].map((y) => (
                    <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--border)" strokeWidth="1" />
                  ))}
                  <polygon points={`0,170 ${CPU_POINTS} 600,170`} fill="url(#cpuFill)" />
                  <polyline
                    points={CPU_POINTS}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={RAM_POINTS}
                    fill="none"
                    stroke="var(--info)"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx="600" cy="34" r="3.5" fill="var(--accent)" />
                </svg>
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9.5px] text-ink-4">
                {["14:00", "14:12", "14:24", "14:36", "14:48", "now"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </Card>

            <div className="overflow-hidden rounded-[14px] border border-line bg-con-bg">
              <div className="flex items-center gap-[9px] border-b border-line bg-bg-2 px-4 py-[10px]">
                <Terminal size={14} strokeWidth={1.7} className="text-ink-4" />
                <span className="font-mono text-[10.5px] text-ink-3">console · tail</span>
                <span className="ml-auto flex items-center gap-[6px] font-mono text-[9.5px] text-success">
                  <span className="h-[5px] w-[5px] animate-(--animate-pulse-dot) rounded-full bg-current" />
                  live
                </span>
                <Link
                  href={`/console?server=${server.id}`}
                  className="text-[11px] text-accent hover:underline"
                >
                  Open console
                </Link>
              </div>
              <div className="px-4 py-3 font-mono text-[11px] leading-[1.85]">
                {CONSOLE_LOG.slice(-4).map((l) => {
                  const c = LOG_COLOUR[l.level];
                  return (
                    <div key={l.time} className="flex gap-3">
                      <span className="shrink-0 pt-px text-[10.5px] text-con-dim">{l.time}</span>
                      <span className={`w-[46px] shrink-0 text-[10.5px] tracking-[0.04em] ${c.level}`}>
                        {l.level}
                      </span>
                      <span className={`min-w-0 truncate ${c.message}`}>{l.message}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-1 text-[13.5px] font-semibold">Details</h2>
              <div className="grid grid-cols-2 gap-x-[18px]">
                {facts.map(([k, v, sub]) => (
                  <div key={k} className="border-b border-line py-3">
                    <div className="mb-[6px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
                      {k}
                    </div>
                    <div className="text-[12.5px] font-medium">{v}</div>
                    <div className="mt-[3px] font-mono text-[10px] text-ink-4">{sub}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Players online</h2>
                <span className="ml-auto font-mono text-[10.5px] text-ink-4 tnum">
                  {server.players.online}
                </span>
              </div>
              {ONLINE_PLAYERS.map((p, i) => (
                <div
                  key={p.name}
                  className={`flex items-center gap-[10px] py-2 ${i < ONLINE_PLAYERS.length - 1 ? "border-b border-line" : ""}`}
                >
                  <Cover tag="SKIN" size={24} radius={6} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{p.name}</span>
                  <span className="font-mono text-[10px] text-ink-4 tnum">{p.ping} ms</span>
                </div>
              ))}
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Recent backups</h2>
                <Link href="/backups" className="ml-auto text-[11.5px] text-accent hover:underline">
                  All
                </Link>
              </div>
              {BACKUPS.map((b, i) => (
                <div
                  key={b.name}
                  className={`flex items-center gap-[10px] py-2 ${i < BACKUPS.length - 1 ? "border-b border-line" : ""}`}
                >
                  <span
                    className={`h-[5px] w-[5px] shrink-0 rounded-full ${b.ok ? "bg-success" : "bg-ink-4"}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{b.name}</span>
                  <span className="font-mono text-[10px] text-ink-4">{b.size}</span>
                  <span className="w-[52px] text-right text-[10.5px] text-ink-4">{b.when}</span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
