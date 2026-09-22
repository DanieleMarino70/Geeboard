import Link from "next/link";
import { NoServers } from "@/components/no-servers";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { can } from "@/domain/access/permissions";
import { isUp } from "@/domain/servers/state";
import { requireUser } from "@/lib/auth";
import { classifyServerLine, type LogLine } from "@/lib/console-fixture";
import { findGame } from "@/domain/games/registry";
import { acceptsCommands, redactSecrets } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { settleStale } from "@/lib/daemon-sim";
import { getServerBySlug, getServers } from "@/lib/queries";
import { ConsoleView } from "./console-view";

export const dynamic = "force-dynamic";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  await settleStale();

  /* Resolve to a slug first, then load the full record once — the list
     query returns a lighter node than the agent needs. */
  const { server: requested } = await searchParams;
  const all = await getServers();
  const slug = requested && all.some((s) => s.slug === requested) ? requested : all[0]?.slug;
  const server = slug ? await getServerBySlug(slug) : null;
  if (!server) return <NoServers user={shellUser(user)} section="Console" />;

  /* The backlog is fetched here rather than streamed, so the console is
     already populated on first paint instead of filling in afterwards. */
  const runtime = runtimeFor(server.node);
  const hasAgent = runtime !== null && Boolean(server.runtimeId);

  /* A real node with no workload for this server. The console view reads
     "no workload" as "no agent" and shows the simulated fixture, which on
     a real machine is a fake console for a server that is not running
     anywhere. Say what is true instead. */
  if (runtime && !server.runtimeId) {
    return (
      <AppShell crumbs={[{ label: server.name, href: `/servers/${server.slug}` }, "Console"]} user={shellUser(user)}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Console</h1>
          <ServerTabs slug={server.slug} active="console" gameId={server.gameId} />
          <ServerSwitcher servers={all} current={server.slug} basePath="/console" />
          <div className="flex flex-col items-start gap-3 rounded-[14px] border border-line bg-card p-6">
            <h2 className="text-[15px] font-semibold">{server.name} has no workload on {server.node.name}</h2>
            <p className="max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
              {server.state === "ERROR"
                ? "There is nothing running to show output from or send commands to. Rebuild it from its page — its files are still there."
                : "It has not been installed there yet. Its console appears once it has."}
            </p>
            <Link href={`/servers/${server.slug}`} className="text-[12.5px] text-accent hover:underline">
              Open {server.name}
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  let initialLines: LogLine[] = [];
  if (runtime && server.runtimeId) {
    try {
      /* Read with timestamps (since the epoch, so the tail is unchanged):
         every backlog line used to be stamped with the time the page
         loaded, so a boot log from yesterday read as having just happened. */
      const lines = await runtime.logs({ serverId: server.id, runtimeId: server.runtimeId }, 200, new Date(0));
      const definition = server.gameId ? findGame(server.gameId) : undefined;
      initialLines = lines.map((l) => ({
        time: (l.at ? new Date(l.at) : new Date()).toLocaleTimeString("en-GB", { hour12: false }),
        level: classifyServerLine(l.line, l.stderr),
        message: redactSecrets(definition, l.line),
      }));
    } catch {
      // The stream will report the fault; an empty backlog is fine.
    }
  }

  return (
    <AppShell crumbs={[{ label: server.name, href: `/servers/${server.slug}` }, "Console"]} user={shellUser(user)}>
      <ConsoleView
        serverName={server.name}
        nodeName={server.node.name}
        slug={server.slug}
        running={isUp(server.state)}
        hasAgent={hasAgent}
        canType={can(user, "server.console.write", server.ownerId)}
        /* Valheim and anything else driven by signals alone: the output
           is worth watching, the prompt would do nothing. */
        acceptsCommands={
          server.gameId ? (findGame(server.gameId) ? acceptsCommands(findGame(server.gameId)!.console) : true) : true
        }
        initialLines={initialLines}
        suggestions={(server.gameId ? findGame(server.gameId)?.console.examples : undefined) ?? []}
        navigation={
          <>
            <ServerTabs slug={server.slug} active="console" gameId={server.gameId} />
            <ServerSwitcher servers={all} current={server.slug} basePath="/console" />
          </>
        }
      />
    </AppShell>
  );
}
