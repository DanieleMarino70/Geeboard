import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Cpu, HardDrive, MemoryStick, Plus } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Notice } from "@/components/form";
import { PosterArt } from "@/components/poster";
import { StatePill } from "@/components/state-pill";
import { Badge, Card, Label, LinkButton } from "@/components/ui";
import { can } from "@/domain/access/permissions";
import { CAPABILITY_LABELS } from "@/domain/games/types";
import { findGame, isCommunityId, isOffered } from "@/domain/games/registry";
import { nodeAway } from "@/domain/nodes/away";
import { requireUser } from "@/lib/auth";
import { formatReleased } from "@/lib/catalog";
import { storedCatalog } from "@/lib/catalog-read";
import { postersFor } from "@/lib/game-posters";
import { STATE_META, UNKNOWN_META } from "@/lib/state-meta";
import { shellUser } from "@/lib/ui-types";
import { hostedServers } from "../hosted";

export const dynamic = "force-dynamic";

/* One game: what its poster on the Games page leads to. What the catalog's card used to hold — what it asks of a node, how it is
   installed, its versions — with the templates a new server can start from, the servers it already runs here, and the way to make one.

   A community game is here too, by its id. One an owner retired is still found (its servers need it) and says it is no longer offered:
   nothing new can be made from it. */

const INSTALL_LABEL: Record<string, string> = {
  image: "a maintained build",
  steamcmd: "SteamCMD",
  download: "the game's own download",
};

const OS_LABEL: Record<string, string> = { linux: "Linux", windows: "Windows" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: findGame((await params).id)?.name ?? "Game not found" };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const game = findGame(id);
  if (!game) notFound();

  const [catalog, servers, posters] = await Promise.all([storedCatalog(game.id), hostedServers(user, game), postersFor([game.id])]);
  const offered = isOffered(game.id);
  const community = isCommunityId(game.id);
  const creates = can(user, "server.create");
  const versions = catalog?.candidates ?? [];
  const req = game.requirements;

  return (
    <AppShell crumbs={[{ label: "Games", href: "/games" }, game.name]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row">
          <div className="relative aspect-[2/3] w-[120px] shrink-0 overflow-hidden rounded-[14px] border border-line bg-card shadow-e1 sm:w-[150px] lg:w-[168px]">
            <PosterArt game={game.id} tag={game.art} poster={posters.get(game.id)} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[10px]">
              <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">{game.name}</h1>
              {game.official && <Badge>official</Badge>}
              {community && <Badge tone="warning">community</Badge>}
            </div>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">{game.blurb}</p>
            <p className="mt-[10px] font-mono text-[11px] text-ink-4">
              {community ? "Runs the image its manifest names" : `Installed from ${INSTALL_LABEL[game.install.kind]}`} ·{" "}
              {servers.length > 0 ? `${servers.length} hosted here` : "none hosted here yet"}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {offered && creates && (
                <LinkButton href={`/servers/new?game=${game.id}`} icon={Plus}>
                  Create a server
                </LinkButton>
              )}
              {offered && !creates && (
                <p className="text-[12px] text-ink-3">Owners and admins create servers: ask one of them for a server of this game.</p>
              )}
            </div>
            {!offered && (
              <div className="mt-4 max-w-[70ch]">
                <Notice tone="warning">
                  An owner retired this game. The servers already made from it still run, and nothing new can be made from it.
                </Notice>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-[10px] border-b border-line px-[18px] py-[13px]">
                <h2 className="text-[13.5px] font-semibold">Versions</h2>
                <span className="font-mono text-[10.5px] text-ink-4">
                  {versions.length} version{versions.length === 1 ? "" : "s"}
                  {catalog?.recommended ? ` · ${catalog.recommended.label} recommended` : ""}
                </span>
              </div>
              {/* The game moving ahead of what Geeboard can install is worth saying out loud rather than showing as up to date. */}
              {catalog?.gameLatest && catalog.supportedLatest?.upstream && catalog.gameLatest !== catalog.supportedLatest.upstream && (
                <div className="border-b border-line px-[18px] py-[10px]">
                  <Notice tone="warning">
                    The game is on {catalog.gameLatest}, which Geeboard does not install yet. The newest it does is{" "}
                    {catalog.supportedLatest.label}.
                  </Notice>
                </div>
              )}
              {versions.length === 0 ? (
                <p className="px-[18px] py-[14px] text-[12px] text-ink-3">No version is listed for this game yet.</p>
              ) : (
                <ul role="list">
                  {versions.map((v, i) => (
                    <li
                      key={v.id}
                      className={`flex flex-wrap items-baseline gap-x-[10px] gap-y-1 px-[18px] py-[10px] ${i < versions.length - 1 ? "border-b border-line" : ""}`}
                    >
                      <span className="min-w-0 text-[12.5px] font-medium">{v.label}</span>
                      {v.recommended && <Badge>recommended</Badge>}
                      {v.channel !== "stable" && <Badge tone="muted">{v.channel}</Badge>}
                      {!v.supported && <Badge tone="warning">not installed</Badge>}
                      <span className="ml-auto font-mono text-[10.5px] text-ink-4">{v.released ? formatReleased(v.released) : ""}</span>
                      {v.note && <p className="basis-full text-[11.5px] leading-relaxed text-ink-3">{v.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-line px-[18px] py-[13px]">
                <h2 className="text-[13.5px] font-semibold">Templates</h2>
                <p className="mt-[3px] text-[11.5px] text-ink-3">What a new server&rsquo;s settings start from. Every one can be changed afterwards.</p>
              </div>
              <ul role="list">
                {game.templates.map((t, i) => (
                  <li key={t.id} className={`px-[18px] py-[11px] ${i < game.templates.length - 1 ? "border-b border-line" : ""}`}>
                    <div className="text-[12.5px] font-medium">{t.name}</div>
                    <p className="mt-[2px] text-[11.5px] leading-relaxed text-ink-3">{t.blurb}</p>
                    <p className="mt-[3px] font-mono text-[10.5px] text-ink-4">{t.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-[10px] border-b border-line px-[18px] py-[13px]">
                <h2 className="text-[13.5px] font-semibold">Hosted here</h2>
                <span className="font-mono text-[10.5px] text-ink-4">
                  {servers.length} server{servers.length === 1 ? "" : "s"}
                </span>
              </div>
              {servers.length === 0 ? (
                <div className="px-6 py-[36px] text-center">
                  <div className="text-[13.5px] font-semibold">No server of this game yet</div>
                  <p className="mx-auto mt-2 max-w-[44ch] text-xs leading-relaxed text-ink-3">
                    {offered && creates
                      ? `A new one asks for ${game.defaults.memoryGb} GB of memory to start with, and at least ${req.memoryGbMin} GB.`
                      : "The servers made from it will be listed here."}
                  </p>
                </div>
              ) : (
                <ul role="list">
                  {servers.map((s, i) => {
                    const away = nodeAway(s.node);
                    const state = away ? UNKNOWN_META : STATE_META[s.state];
                    return (
                      <li key={s.id} className={i < servers.length - 1 ? "border-b border-line" : undefined}>
                        <Link
                          href={`/servers/${s.slug}`}
                          className="flex items-center gap-3 px-[18px] py-[11px] transition-colors duration-150 hover:bg-card-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium">{s.name}</div>
                            <div className="mt-[2px] truncate font-mono text-[10px] text-ink-4">
                              {s.host}:{s.port} · {s.version} · on {s.node.name}
                            </div>
                          </div>
                          <StatePill slug={s.slug} tone={state.tone} label={state.label} pulse={state.pulse} />
                          <ChevronRight size={14} strokeWidth={1.8} className="shrink-0 text-ink-4" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold">What it asks of a node</h2>
              <ul role="list" className="flex flex-col gap-[9px] font-mono text-[11px] text-ink-3">
                <li className="flex items-center gap-[8px]">
                  <MemoryStick size={13} strokeWidth={1.7} className="shrink-0 text-ink-4" aria-hidden />
                  <span>{req.memoryGbMin} GB of memory, at least</span>
                </li>
                <li className="flex items-center gap-[8px]">
                  <Cpu size={13} strokeWidth={1.7} className="shrink-0 text-ink-4" aria-hidden />
                  <span>
                    {req.cpuPctMin / 100} core{req.cpuPctMin === 100 ? "" : "s"}, at least
                  </span>
                </li>
                <li className="flex items-center gap-[8px]">
                  <HardDrive size={13} strokeWidth={1.7} className="shrink-0 text-ink-4" aria-hidden />
                  <span>{req.diskGbMin} GB of storage, at least</span>
                </li>
                <li>
                  {req.os.map((os) => OS_LABEL[os] ?? os).join(" or ")} · {req.arch.join(" or ")}
                </li>
              </ul>
              <Label className="mt-4 mb-2 block">Capabilities</Label>
              <div className="flex flex-wrap gap-[5px]">
                {req.capabilities.map((capability) => (
                  <Badge key={capability} tone="muted">
                    {CAPABILITY_LABELS[capability]}
                  </Badge>
                ))}
              </div>
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13.5px] font-semibold">A new server starts with</h2>
              <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-[9px] font-mono text-[11px] text-ink-3">
                <li>{game.defaults.memoryGb} GB memory</li>
                <li>
                  {game.defaults.cpuLimit / 100} core{game.defaults.cpuLimit === 100 ? "" : "s"}
                </li>
                <li>{game.defaults.diskGb} GB storage</li>
                <li>{game.defaults.playersMax} players</li>
              </ul>
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                The wizard fits these to the node it is put on, and they can be changed on its fourth step.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
