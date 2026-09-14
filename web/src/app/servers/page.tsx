import Link from "next/link";
import { ChevronRight, Filter, Plus } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Cover, LinkButton, Meter, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { settleStale } from "@/lib/daemon-sim";
import { STATE_META, getServers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const user = await requireUser();
  await settleStale();
  const servers = await getServers();
  const up = servers.filter((s) => s.state === "RUNNING" || s.state === "STARTING").length;
  const simulated = servers.filter((s) => s.simulated).length;

  return (
    <AppShell crumbs={["Ashfold", "Servers"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Servers</h1>
            <p className="mt-[7px] text-[12.5px] leading-snug text-ink-3">
              {servers.length} server{servers.length === 1 ? "" : "s"} across{" "}
              {new Set(servers.map((s) => s.nodeId)).size} node
              {new Set(servers.map((s) => s.nodeId)).size === 1 ? "" : "s"}, {up} up.
              {simulated > 0 && (
                <span className="text-warning">
                  {" "}
                  {simulated} {simulated === 1 ? "is" : "are"} simulated — on a node with no agent.
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 sm:ml-auto">
            <Button intent="secondary" icon={Filter}>
              Filter
            </Button>
            <LinkButton href="/servers/new" icon={Plus}>Create server</LinkButton>
          </div>
        </div>

        {servers.length === 0 && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <h2 className="text-[15px] font-semibold">No servers yet</h2>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
              A server runs on a node. Add a node first if there is none, then create a server on it.
            </p>
            <div className="flex gap-2">
              <LinkButton href="/servers/new" icon={Plus}>
                Create server
              </LinkButton>
              <LinkButton href="/nodes" intent="secondary">
                Nodes
              </LinkButton>
            </div>
          </Card>
        )}

        <Card className={servers.length === 0 ? "hidden" : "overflow-hidden"}>
          <div className="hidden grid-cols-[minmax(0,1fr)_120px_128px_140px_92px_100px_24px] gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid">
            {["Server", "Version", "State", "CPU", "Memory", "Players", ""].map((h, i) => (
              <span
                key={h || i}
                className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4"
              >
                {h}
              </span>
            ))}
          </div>

          {servers.map((s, i) => {
            const state = STATE_META[s.state];
            return (
              <Link
                key={s.id}
                href={`/servers/${s.slug}`}
                className={`grid grid-cols-1 items-center gap-x-[14px] gap-y-3 px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:grid-cols-[minmax(0,1fr)_120px_128px_140px_92px_100px_24px] lg:py-[11px] ${
                  i < servers.length - 1 ? "border-b border-line" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-[11px]">
                  <Cover tag={s.art} size={32} radius={9} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{s.name}</div>
                    <div className="mt-[2px] truncate font-mono text-[10px] text-ink-4">
                      {s.host}:{s.port}
                    </div>
                  </div>
                </div>

                <span className="font-mono text-[10.5px] text-ink-4">{s.version}</span>

                <div className="flex flex-wrap items-center gap-[6px]">
                  <Pill tone={state.tone} pulse={state.pulse}>
                    {state.label}
                  </Pill>
                  {s.simulated && <Badge tone="warning">sim</Badge>}
                </div>

                <div className="flex items-center gap-2">
                  <span className="flex-1">
                    <Meter
                      value={s.cpuPct}
                      colour={s.cpuPct > 60 ? "var(--warning)" : "var(--accent)"}
                      height={3}
                    />
                  </span>
                  <span className="w-[30px] text-right font-mono text-[10px] text-ink-3 tnum">
                    {s.cpuPct}%
                  </span>
                </div>

                <span className="font-mono text-[10.5px] text-ink-3 tnum">{s.ramPct}%</span>

                <span className="font-mono text-[10.5px] text-ink-3 tnum">
                  {s.playersOn} / {s.playersMax}
                </span>

                <ChevronRight
                  size={15}
                  strokeWidth={1.7}
                  className="hidden justify-self-end text-ink-4 lg:block"
                />
              </Link>
            );
          })}
        </Card>
      </div>
    </AppShell>
  );
}
