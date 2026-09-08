import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { settleStale } from "@/lib/daemon-sim";
import { getServerBySlug, getServers } from "@/lib/queries";
import { ConsoleView } from "./console-view";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  await settleStale();
  const { server: slug } = await searchParams;
  const server = (slug ? await getServerBySlug(slug) : null) ?? (await getServers())[0];
  if (!server) return null;

  return (
    <AppShell crumbs={["Ashfold", server.name, "Console"]} user={user}>
      <ConsoleView
        serverName={server.name}
        nodeName={server.node.name}
        slug={server.slug}
        running={server.state === "RUNNING" || server.state === "STARTING"}
      />
    </AppShell>
  );
}
