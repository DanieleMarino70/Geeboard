import Link from "next/link";
import { ChevronRight, Plus, Search } from "lucide-react";
import type { ServerState } from "@prisma/client";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { LiveRefresh } from "@/components/live-refresh";
import { NodeAway } from "@/components/node-away";
import { StatePill } from "@/components/state-pill";
import { Badge, Card, Cover, LinkButton, Meter } from "@/components/ui";
import { can } from "@/domain/access/permissions";
import { findGame } from "@/domain/games/registry";
import { nodeAway } from "@/domain/nodes/away";
import { isUp } from "@/domain/servers/state";
import { requireUser } from "@/lib/auth";
import { settleStale } from "@/lib/daemon-sim";
import { STATE_META, UNKNOWN_META, getServers, nodesInServiceCount } from "@/lib/queries";

export const dynamic = "force-dynamic";

/* Filters are groups a person asks about, not the fourteen states: what
   is serving players, what needs somebody, what is off. Anything
   mid-change belongs to none of the last two and shows under All. */
const ATTENTION: ServerState[] = ["CRASHED", "ERROR", "UNHEALTHY"];
const OFF: ServerState[] = ["STOPPED", "SUSPENDED"];
/* null is a server on a node the panel cannot see: not up, not off, not in need of anything it could know of. It is under All, and says why. */
const SHOW = {
  all: { label: "All", test: () => true },
  up: { label: "Up", test: (s: ServerState | null) => s !== null && isUp(s) },
  attention: { label: "Needs attention", test: (s: ServerState | null) => s !== null && ATTENTION.includes(s) },
  off: { label: "Stopped", test: (s: ServerState | null) => s !== null && OFF.includes(s) },
} as const;
type Show = keyof typeof SHOW;

const COLS = "lg:grid-cols-[minmax(0,1fr)_120px_128px_140px_92px_100px_24px]";

export const metadata = { title: "Servers" };

export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string }>;
}) {
  const user = await requireUser();
  await settleStale();
  const params = await searchParams;
  const show: Show = params.show && params.show in SHOW ? (params.show as Show) : "all";
  const q = (params.q ?? "").trim().toLowerCase();

  const servers = await getServers(user);
  const noNode = (await nodesInServiceCount()) === 0;
  // A member is given servers and cannot make one; the page says which it is.
  const creates = can(user, "server.create");
  // What the panel knows of a server: its state, unless its node has gone quiet.
  const known = (s: (typeof servers)[number]): ServerState | null => (nodeAway(s.node) ? null : s.state);
  const up = servers.filter((s) => SHOW.up.test(known(s))).length;
  const unknown = servers.filter((s) => known(s) === null).length;
  const moving = servers.some((s) => known(s) !== null && STATE_META[s.state].pulse);
  const simulated = servers.filter((s) => s.simulated).length;
  const nodeCount = new Set(servers.map((s) => s.nodeId)).size;
  const shown = servers.filter(
    (s) =>
      SHOW[show].test(known(s)) &&
      (!q || [s.name, s.host, s.slug, s.version, s.node.name].some((v) => v.toLowerCase().includes(q))),
  );

  const href = (next: Show) => {
    const p = new URLSearchParams();
    if (next !== "all") p.set("show", next);
    if (q) p.set("q", params.q!.trim());
    const s = p.toString();
    return s ? `/servers?${s}` : "/servers";
  };

  return (
    <AppShell crumbs={["Servers"]} user={shellUser(user)}>
      <LiveRefresh active={moving} />
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Servers</h1>
            <p className="mt-[7px] text-[12.5px] leading-snug text-ink-3">
              {servers.length} server{servers.length === 1 ? "" : "s"} across {nodeCount} node
              {nodeCount === 1 ? "" : "s"}, {up} up.
              {unknown > 0 && (
                <span className="text-warning-fg">
                  {" "}
                  {unknown} {unknown === 1 ? "is" : "are"} unknown: {unknown === 1 ? "its" : "their"} node is not answering.
                </span>
              )}
              {simulated > 0 && (
                <span className="text-warning-fg">
                  {" "}
                  {simulated} {simulated === 1 ? "is" : "are"} simulated — on a node with no agent.
                </span>
              )}
            </p>
          </div>
          {creates && (
            <div className="flex shrink-0 gap-2 sm:ml-auto">
              <LinkButton href={noNode ? "/nodes" : "/servers/new"} icon={Plus}>{noNode ? "Add a node" : "Create server"}</LinkButton>
            </div>
          )}
        </div>

        {servers.length === 0 && creates && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <h2 className="text-[15px] font-semibold">No servers yet</h2>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
              {noNode
                ? "A server runs on a node, and there is no node yet. Add a node first, then create a server on it."
                : "Create a server on one of your nodes."}
            </p>
            <div className="flex gap-2">
              {noNode ? (
                <LinkButton href="/nodes" icon={Plus}>
                  Add a node
                </LinkButton>
              ) : (
                <>
                  <LinkButton href="/servers/new" icon={Plus}>
                    Create server
                  </LinkButton>
                  <LinkButton href="/nodes" intent="secondary">
                    Nodes
                  </LinkButton>
                </>
              )}
            </div>
          </Card>
        )}
        {servers.length === 0 && !creates && (
          <Card className="flex flex-col items-start gap-3 p-6">
            <h2 className="text-[15px] font-semibold">No server is yours yet</h2>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
              You see the servers that were given to you, and none has been. An owner or an admin
              gives one from its Settings page.
            </p>
          </Card>
        )}

        {servers.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <nav aria-label="Filter by state" className="flex flex-wrap gap-[6px]">
              {(Object.keys(SHOW) as Show[]).map((key) => {
                const count = servers.filter((s) => SHOW[key].test(known(s))).length;
                const active = key === show;
                return (
                  <Link
                    key={key}
                    href={href(key)}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg border px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                      active
                        ? "border-line-2 bg-card-2 text-ink"
                        : "border-line text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {SHOW[key].label}
                    <span className="ml-[6px] font-mono text-[10px] text-ink-4 tnum">{count}</span>
                  </Link>
                );
              })}
            </nav>
            {/* A plain GET form: the filter lives in the address, so it
                survives a reload and can be linked to. */}
            <form action="/servers" className="relative sm:ml-auto sm:w-[240px]">
              {show !== "all" && <input type="hidden" name="show" value={show} />}
              <Search
                size={13}
                strokeWidth={1.8}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2 text-ink-4"
              />
              <input
                type="search"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Name, address, node…"
                aria-label="Search servers"
                className="w-full rounded-lg border border-control bg-bg-2 py-[7px] pr-3 pl-[30px] text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent placeholder:text-ink-4 focus:border-accent"
              />
            </form>
          </div>
        )}

        {servers.length > 0 && shown.length === 0 && (
          <Card className="flex flex-col items-start gap-2 p-5">
            <p className="text-[12.5px] text-ink-3">No server matches this filter.</p>
            <Link href="/servers" className="text-[12px] text-accent-fg hover:underline">
              Show all servers
            </Link>
          </Card>
        )}

        <Card className={shown.length === 0 ? "hidden" : "overflow-hidden"}>
          <div className={`hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid ${COLS}`}>
            {["Server", "Version", "State", "CPU", "Memory", "Players", ""].map((h, i) => (
              <span
                key={h || i}
                className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4"
              >
                {h}
              </span>
            ))}
          </div>

          {shown.map((s, i) => {
            const away = nodeAway(s.node);
            const state = away ? UNKNOWN_META : STATE_META[s.state];
            return (
              <Link
                key={s.id}
                href={`/servers/${s.slug}`}
                className={`grid grid-cols-2 items-center gap-x-[14px] gap-y-3 px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${COLS} ${
                  i < shown.length - 1 ? "border-b border-line" : ""
                }`}
              >
                <div className="col-span-2 flex min-w-0 items-center gap-[11px] lg:col-span-1">
                  <Cover tag={s.art} game={s.gameId} size={32} radius={9} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{s.name}</div>
                    <div className="mt-[2px] truncate font-mono text-[10px] text-ink-4">
                      {s.host}:{s.port}
                    </div>
                  </div>
                </div>

                <span className="truncate font-mono text-[10.5px] text-ink-4">{s.version}</span>

                <div className="flex flex-wrap items-center gap-[6px]">
                  <StatePill slug={s.slug} tone={state.tone} label={state.label} pulse={state.pulse} />
                  {s.simulated && <Badge tone="warning">sim</Badge>}
                  {away && (
                    <span className="basis-full text-[10.5px] leading-snug text-warning-fg">
                      <NodeAway node={s.node.name} reason={away.reason} since={away.since?.toISOString() ?? null} />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-4 lg:sr-only">CPU</span>
                  <span className="flex-1">
                    {away ? (
                      <span className="block h-[3px] rounded-full bg-card-2" aria-hidden />
                    ) : (
                      <Meter
                        label={`${s.name} CPU`}
                        value={s.cpuPct}
                        colour={s.cpuPct > 60 ? "var(--warning)" : "var(--accent)"}
                        height={3}
                      />
                    )}
                  </span>
                  <span className="w-[30px] text-right font-mono text-[10px] text-ink-3 tnum">
                    {away ? "—" : `${s.cpuPct}%`}
                  </span>
                </div>

                <span className="font-mono text-[10.5px] text-ink-3 tnum">
                  <span className="text-ink-4 lg:sr-only">RAM </span>
                  {away ? "—" : `${s.ramPct}%`}
                </span>

                <span className="font-mono text-[10.5px] text-ink-3 tnum">
                  <span className="text-ink-4 lg:sr-only">Players </span>
                  {away || !(s.gameId && findGame(s.gameId)?.console.players) ? "—" : s.playersOn} / {s.playersMax}
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
