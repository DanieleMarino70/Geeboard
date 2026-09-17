import { NoServers } from "@/components/no-servers";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { AppShell } from "@/components/shell";
import { findGame } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import { requireUser } from "@/lib/auth";
import { currentConfig } from "@/lib/config-ops";
import { formatBytes } from "@/lib/format";
import { getServerBySlug, getServers } from "@/lib/queries";
import { settingsLimitsFor } from "@/lib/server-ops";
import { GameSettings } from "./game-settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  const { server: slug } = await searchParams;
  const servers = await getServers();
  const selected = (slug ? await getServerBySlug(slug) : null) ?? (await getServerBySlug(servers[0]?.slug ?? ""));

  if (!selected) return <NoServers user={user} section="Settings" />;

  /* The game's own settings, generated from its definition. A server
     that predates the catalog has no definition to generate from, and
     gets the platform settings only. */
  const game = selected.gameId ? findGame(selected.gameId) : undefined;
  const limits = await settingsLimitsFor(selected);

  return (
    <AppShell crumbs={[{ label: selected.name, href: `/servers/${selected.slug}` }, "Settings"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <ServerTabs slug={selected.slug} active="settings" />
        <ServerSwitcher servers={servers} current={selected.slug} basePath="/settings" />

        {/* Keyed on the saved values: a successful save changes the key,
            remounting the form with the new values as its baseline. */}
        <SettingsForm
          key={[selected.name, selected.host, selected.memoryLimit, selected.cpuLimit, selected.restartPolicy, selected.maxRestarts].join("|")}
          limits={limits}
          server={{
            slug: selected.slug,
            name: selected.name,
            host: selected.host,
            port: selected.port,
            memoryLimit: selected.memoryLimit,
            cpuLimit: selected.cpuLimit,
            restartPolicy: selected.restartPolicy,
            maxRestarts: selected.maxRestarts,
            version: selected.version,
            node: selected.node.name,
            worldSize: selected.worldSizeBytes !== null ? formatBytes(selected.worldSizeBytes) : "not measured yet",
            rebuildable: Boolean(runtimeFor(selected.node)) && Boolean(selected.runtimeId),
          }}
        />

        {game && (
          /* Keyed on the stored settings for the same reason the form
             above is: a successful save remounts it with fresh values
             and a clean dirty flag. */
          <GameSettings
            key={JSON.stringify(selected.config ?? {})}
            slug={selected.slug}
            gameName={game.name}
            fields={game.config}
            initial={currentConfig(game, selected)}
          />
        )}
      </div>
    </AppShell>
  );
}
