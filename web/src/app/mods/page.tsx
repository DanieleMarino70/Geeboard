import { Puzzle } from "lucide-react";
import { NoServers } from "@/components/no-servers";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { AppShell } from "@/components/shell";
import { can } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { modsView } from "@/lib/mod-ops";
import { getServerBySlug, getServers } from "@/lib/queries";
import { shellUser } from "@/lib/ui-types";
import { ModWorkshop } from "./workshop";

export const dynamic = "force-dynamic";

export default async function ModsPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const user = await requireUser();
  const { server: requested } = await searchParams;

  const all = await getServers();
  const slug = requested && all.some((s) => s.slug === requested) ? requested : all[0]?.slug;
  const server = slug ? await getServerBySlug(slug) : null;
  if (!server) return <NoServers user={shellUser(user)} section="Mods" />;

  const view = await modsView(user, server.slug);
  const canWrite = can(user, "server.settings.write", server.ownerId);

  return (
    <AppShell crumbs={[{ label: server.name, href: `/servers/${server.slug}` }, "Mods"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Mods</h1>
          <p className="mt-[7px] max-w-[72ch] text-[12.5px] leading-snug text-ink-3">
            Chosen here, downloaded by the game on {server.node.name}. Geeboard writes the list into
            the server&apos;s own settings and never holds a mod&apos;s files itself.
          </p>
        </div>

        <ServerTabs slug={server.slug} active="mods" modsSupported={Boolean(view?.support)} />
        <ServerSwitcher servers={all} current={server.slug} basePath="/mods" />

        {!view || !view.support ? (
          <div className="rounded-[14px] border border-line bg-card px-6 py-[52px] text-center">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
              <Puzzle size={20} strokeWidth={1.6} />
            </div>
            <div className="text-[13.5px] font-semibold">No mods for {server.game}</div>
            <p className="mx-auto mt-2 max-w-[44ch] text-xs leading-relaxed text-ink-4">
              Project Zomboid is the one game Geeboard installs mods for, because its server
              downloads Workshop items itself from its own settings. Another game needs its
              definition to say how it takes mods before this page can offer any.
            </p>
          </div>
        ) : (
          <ModWorkshop slug={server.slug} node={server.node.name} view={view} canWrite={canWrite} />
        )}
      </div>
    </AppShell>
  );
}
