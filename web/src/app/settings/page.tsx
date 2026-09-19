import { NoServers } from "@/components/no-servers";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { AppShell } from "@/components/shell";
import { findGame, versionOfServer } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import { configDrift, scopeToLine } from "@/domain/games/config";
import { requireUser } from "@/lib/auth";
import { configOnNode, currentConfig } from "@/lib/config-ops";
import { db } from "@/lib/db";
import { formatBytes } from "@/lib/format";
import { moveCandidates } from "@/lib/move-ops";
import { offsiteTarget } from "@/lib/storage-ops";
import { MoveServer } from "./move-server";
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
  const definition = selected.gameId ? findGame(selected.gameId) : undefined;
  /* Narrowed to the server's version line: a build 41 world gets build
     41's settings, and a server whose version no longer resolves gets
     only the settings every version shares. */
  const game = definition
    ? scopeToLine(definition, versionOfServer(definition, { versionSlug: selected.gameVersionRef?.slug, versionLabel: selected.version })?.line)
    : undefined;
  const limits = await settingsLimitsFor(selected);

  /* What the panel last wrote, and what the server's files say now. The
     form shows the second where they disagree — the file is what the
     game will actually read — and names what changed underneath it. */
  const stored = game ? currentConfig(game, selected) : {};
  const onNode = game ? await configOnNode(selected, game) : { values: {}, read: false };
  const drift = game ? configDrift(game, stored, onNode.values) : [];

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

        {(user.role === "OWNER" || user.role === "ADMIN") && (
          <MoveServer
            slug={selected.slug}
            name={selected.name}
            currentNode={selected.node.name}
            candidates={await moveCandidates(selected, definition)}
            offsite={(await offsiteTarget()) !== null}
            running={selected.state === "RUNNING" || selected.state === "UNHEALTHY"}
            localBackups={await db.backup.count({ where: { serverId: selected.id, store: { not: "S3" } } })}
            lockedLocal={await db.backup.count({ where: { serverId: selected.id, store: { not: "S3" }, state: "LOCKED" } })}
          />
        )}

        {game && (
          /* Keyed on the values it is given for the same reason the form
             above is: a successful save remounts it with fresh values
             and a clean dirty flag. */
          <GameSettings
            key={JSON.stringify({ ...stored, ...onNode.values })}
            slug={selected.slug}
            gameName={game.name}
            fields={game.config}
            initial={{ ...stored, ...onNode.values }}
            drift={drift}
          />
        )}
      </div>
    </AppShell>
  );
}
