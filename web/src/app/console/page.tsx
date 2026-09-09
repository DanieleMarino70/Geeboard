import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { classifyServerLine, type LogLine } from "@/lib/console-fixture";
import { agentFor } from "@/lib/daemon-client";
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
  if (!server) return null;

  /* The backlog is fetched here rather than streamed, so the console is
     already populated on first paint instead of filling in afterwards. */
  const agent = agentFor(server.node);
  const hasAgent = agent !== null && Boolean(server.containerId);

  let initialLines: LogLine[] = [];
  if (agent && server.containerId) {
    try {
      const lines = await agent.logs(server.containerId, 200);
      initialLines = lines.map((l) => ({
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        level: classifyServerLine(l.line, l.stderr),
        message: l.line,
      }));
    } catch {
      // The stream will report the fault; an empty backlog is fine.
    }
  }

  return (
    <AppShell crumbs={["Ashfold", server.name, "Console"]} user={user}>
      <ConsoleView
        serverName={server.name}
        nodeName={server.node.name}
        slug={server.slug}
        running={server.state === "RUNNING" || server.state === "STARTING"}
        hasAgent={hasAgent}
        initialLines={initialLines}
      />
    </AppShell>
  );
}
