import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getServerBySlug, getServers } from "@/lib/queries";
import { ConsoleView } from "./console-view";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  const { server: slug } = await searchParams;
  const server = (slug ? await getServerBySlug(slug) : null) ?? (await getServers())[0];
  if (!server) return null;

  return (
    <AppShell crumbs={["Ashfold", server.name, "Console"]} user={user}>
      <ConsoleView serverName={server.name} nodeName={server.node.name} />
    </AppShell>
  );
}
