import { AppShell } from "@/components/shell";
import { SERVERS, getServer } from "@/lib/mock";
import { ConsoleView } from "./console-view";

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const { server: id } = await searchParams;
  const server = (id ? getServer(id) : undefined) ?? SERVERS[0];

  return (
    <AppShell crumbs={["Ashfold", server.name, "Console"]}>
      <ConsoleView serverName={server.name} />
    </AppShell>
  );
}
