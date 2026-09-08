import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Archive,
  Download,
  HardDrive,
  MoreHorizontal,
  Plus,
  RotateCw,
  Server as ServerIcon,
  Square,
  Terminal,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/shell";
import { Button, Card, Cover, Label, Meter, Pill, Spark } from "@/components/ui";
import { ACTIVITY, NODES, SERVERS, STATE_TONE, STATS, type GameServer } from "@/lib/mock";

const STAT_ICONS = {
  server: ServerIcon,
  users: Users,
  activity: Activity,
  drive: HardDrive,
} as const;

const DELTA_TONE = {
  up: "text-success bg-success-soft",
  down: "text-danger bg-danger-soft",
  flat: "text-ink-3 bg-card-2",
} as const;

const ACTIVITY_DOT = {
  info: "bg-info",
  accent: "bg-accent",
  muted: "bg-ink-4",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

function ServerCard({ server }: { server: GameServer }) {
  const state = STATE_TONE[server.state];
  const sparkColour =
    server.state === "starting"
      ? "hsl(38 94% 58%)"
      : server.state === "stopped"
        ? "hsl(228 10% 56%)"
        : "hsl(80 72% 60%)";

  return (
    <Card hover className="overflow-hidden">
      <div className="flex items-start gap-[13px] p-[18px]">
        <Cover tag={server.art} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/servers/${server.id}`}
            className="block truncate text-[14.5px] font-semibold tracking-[-0.015em] hover:text-accent"
          >
            {server.name}
          </Link>
          <div className="mt-1 font-mono text-[10px] text-ink-4">{server.version}</div>
          <div className="mt-[9px] flex items-center gap-[7px]">
            <Pill tone={state.tone} pulse={state.pulse}>
              {state.label}
            </Pill>
            <span className="font-mono text-[10.5px] text-ink-3 tnum">
              {server.players.online} / {server.players.max}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label={`Actions for ${server.name}`}
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
        >
          <MoreHorizontal size={15} strokeWidth={1.7} />
        </button>
      </div>

      <div className="px-[18px] pb-3">
        <Spark points={server.spark} colour={sparkColour} id={`sp-${server.id}`} />
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-line bg-(--border)">
        {(
          [
            ["CPU", server.cpu, "var(--accent)"],
            ["RAM", server.ram, "var(--info)"],
            ["DISK", server.disk, "var(--ink-4)"],
          ] as const
        ).map(([k, v, colour]) => (
          <div key={k} className="bg-card px-[13px] py-[11px]">
            <div className="mb-[6px] flex justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-ink-4">{k}</span>
              <span className="font-mono text-[10px] text-ink-2 tnum">{v}%</span>
            </div>
            <Meter value={v} colour={colour} height={3} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-bg-2 px-[18px] py-[10px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-4">
          {server.address}
        </span>
        <span className="flex gap-1">
          {(
            [
              [RotateCw, "Restart"],
              [Square, "Stop"],
              [Terminal, "Console"],
            ] as const
          ).map(([Icon, labelText]) => (
            <button
              key={labelText}
              type="button"
              aria-label={`${labelText} ${server.name}`}
              className="grid h-6 w-6 place-items-center rounded-md text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
            >
              <Icon size={13} strokeWidth={1.7} />
            </button>
          ))}
        </span>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <AppShell crumbs={["Ashfold", "Dashboard"]}>
      <div className="relative flex flex-col gap-5 px-5 py-[26px] sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[180px] -right-[120px] h-[360px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
        />

        <div className="relative flex flex-col items-start gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <h1 className="text-[clamp(24px,3.4vw,30px)] leading-[1.1] font-semibold tracking-[-0.025em]">
              Good afternoon, Mara
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
              Three of four servers are up and holding 19.8 ticks per second. Singapore is the one to
              watch.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 md:ml-auto">
            <Button intent="secondary" icon={Download}>
              Import a server
            </Button>
            <Button icon={Plus}>Create server</Button>
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-4 xl:grid-cols-4">
          {STATS.map((s) => {
            const Icon = STAT_ICONS[s.icon];
            return (
              <Card key={s.label} hover className="p-5">
                <div className="mb-[14px] flex items-center gap-2">
                  <span className="grid place-items-center text-ink-4">
                    <Icon size={14} strokeWidth={1.7} />
                  </span>
                  <Label>{s.label}</Label>
                </div>
                <div className="flex items-end gap-2">
                  <div className="text-[30px] leading-none font-semibold tracking-[-0.03em] tnum">
                    {s.value}
                  </div>
                  <div className="pb-[3px] text-xs text-ink-4">{s.unit}</div>
                </div>
                <div className="mt-3 flex items-center gap-[7px]">
                  <span
                    className={`rounded-[5px] px-[6px] py-[2px] font-mono text-[10.5px] ${DELTA_TONE[s.deltaTone]}`}
                  >
                    {s.delta}
                  </span>
                  <span className="text-[11.5px] text-ink-4">{s.sub}</span>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="relative grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_348px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Your servers</h2>
              <span className="font-mono text-[11px] text-ink-4">4 total · 3 up</span>
              <Link href="/servers" className="ml-auto text-[12.5px] text-accent hover:underline">
                Manage all
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {SERVERS.map((s) => (
                <ServerCard key={s.id} server={s} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <div className="mb-4 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Activity</h2>
                <Link href="/activity" className="ml-auto text-[11.5px] text-accent hover:underline">
                  All events
                </Link>
              </div>
              {ACTIVITY.map((a, i) => (
                <div key={a.who + a.when} className="flex gap-[13px] pb-3 last:pb-0">
                  <div className="relative flex w-[9px] shrink-0 justify-center pt-[5px]">
                    <span
                      className={`z-1 h-[7px] w-[7px] shrink-0 rounded-full shadow-[0_0_0_3px_var(--card)] ${ACTIVITY_DOT[a.tone]}`}
                    />
                    {i < ACTIVITY.length - 1 && (
                      <span className="absolute top-3 -bottom-3 w-px bg-(--border)" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug text-ink-2">
                      <span className="font-medium text-ink">{a.who}</span> {a.what}
                    </div>
                    <div className="mt-[3px] font-mono text-[10px] text-ink-4">{a.when}</div>
                  </div>
                </div>
              ))}
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="mb-1 flex items-baseline gap-[10px]">
                <h2 className="text-[13.5px] font-semibold">Node health</h2>
                <span className="ml-auto font-mono text-[10.5px] text-ink-4">3 nodes</span>
              </div>
              {NODES.map((n) => (
                <div key={n.id} className="flex flex-col gap-[9px] border-b border-line py-3">
                  <div className="flex items-center gap-[9px]">
                    <span
                      className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                        n.healthy ? "bg-success" : "animate-(--animate-pulse-dot) bg-warning text-warning"
                      }`}
                    />
                    <span className="font-mono text-[11.5px] font-medium">{n.id}</span>
                    <span className="text-[11px] text-ink-4">{n.city}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-ink-3 tnum">{n.ping}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-[10px]">
                    {(
                      [
                        ["CPU", n.cpu],
                        ["RAM", n.ram],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <div className="mb-[5px] flex justify-between font-mono text-[9.5px] text-ink-4">
                          <span>{k}</span>
                          <span className="text-ink-2 tnum">{v}%</span>
                        </div>
                        <Meter
                          value={v}
                          colour={v > 80 ? "var(--warning)" : "var(--accent)"}
                          height={3}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-warning-soft text-warning">
                  <AlertTriangle size={12} strokeWidth={2} />
                </span>
                <span className="text-[11.5px] leading-snug text-ink-3">
                  Singapore at 91% memory — consider draining.
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
