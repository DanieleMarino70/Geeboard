import Link from "next/link";
import { Terminal } from "lucide-react";
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
     query returns a lighter node than the agent needs. With none asked
     for, the first console this person may watch: a member opening
     Console from the sidebar lands on their own server, not on a refusal
     for somebody else's that happens to sort first. */
  const { server: requested } = await searchParams;
  const all = await getServers();
  const fallback = all.find((s) => can(user, "server.console.read", s.ownerId)) ?? all[0];
  const slug = requested && all.some((s) => s.slug === requested) ? requested : fallback?.slug;
  const server = slug ? await getServerBySlug(slug) : null;
  if (!server) return <NoServers user={shellUser(user)} section="Console" />;

  /* Checked before anything is read from the node. This page used to load
     a thousand lines of any server named in ?server= for anyone signed in,
     while the stream beside it refused them: a member, who sees every
     server's page, read every server's console — players' names and
     addresses, and whatever else a game prints. */
  if (!can(user, "server.console.read", server.ownerId)) {
    return (
      <AppShell crumbs={[{ label: server.name, href: `/servers/${server.slug}` }, "Console"]} user={shellUser(user)}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Console</h1>
          <ServerTabs slug={server.slug} active="console" gameId={server.gameId} />
          <ServerSwitcher servers={all} current={server.slug} basePath="/console" />
          <div className="rounded-[14px] border border-line bg-card px-6 py-[52px] text-center">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
              <Terminal size={20} strokeWidth={1.6} />
            </div>
            <div className="text-[13.5px] font-semibold">No console access</div>
            <p className="mx-auto mt-2 max-w-[46ch] text-xs leading-relaxed text-ink-4">
              A console carries players&apos; names and addresses and everything the game prints, so
              it is open to the server&apos;s owner, to moderators and to admins. {server.name} is not
              yours; its page still shows how it is doing.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

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
      /* A thousand, because the view folds runs of progress lines into
         one: Terraria's boot is hundreds of percentages, and at 200 the
         start of the run and its errors were already gone. */
      const lines = await runtime.logs({ serverId: server.id, runtimeId: server.runtimeId }, 1000, new Date(0));
      const definition = server.gameId ? findGame(server.gameId) : undefined;
      // Blank lines are left out, as the live stream leaves them out.
      initialLines = lines.filter((l) => l.line.trim().length > 0).map((l) => ({
        // Formatted in the browser, in its own clock: this runs on the server, in UTC.
        time: "",
        at: l.at,
        level: classifyServerLine(l.line, l.stderr),
        message: redactSecrets(definition, l.line),
      }));
    } catch {
      // The stream will report the fault; an empty backlog is fine.
    }
  }

  return (
    <AppShell crumbs={[{ label: server.name, href: `/servers/${server.slug}` }, "Console"]} user={shellUser(user)}>
      {/* Keyed on the server: the switcher navigates within this page, and
          without a key the view and its stream kept their state across it —
          the last server's lines merged into the next one's, and a console
          closed for a role taken away came back when another was opened. */}
      <ConsoleView
        key={server.slug}
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
        healthLines={server.gameId ? findGame(server.gameId)?.console.healthLines : undefined}
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
