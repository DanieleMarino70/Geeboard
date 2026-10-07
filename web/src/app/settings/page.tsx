import { NoServers } from "@/components/no-servers";
import { ServerSwitcher } from "@/components/server-switcher";
import { ServerTabs } from "@/components/server-tabs";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { can } from "@/domain/access/permissions";
import { findGame, versionOfServer } from "@/domain/games/registry";
import { runtimeFor } from "@/domain/runtime/docker";
import { configDrift, scopeToLine, settingsFor } from "@/domain/games/config";
import { requireUser } from "@/lib/auth";
import { configOnNode, currentConfig } from "@/lib/config-ops";
import { db } from "@/lib/db";
import { dnsProviderFacts } from "@/lib/dns-ops";
import { formatBytes } from "@/lib/format";
import { moveCandidates } from "@/lib/move-ops";
import { offsiteTarget } from "@/lib/storage-ops";
import { leftBehind } from "@/domain/templates/rules";
import { CopyServer } from "./copy-server";
import { MoveServer } from "./move-server";
import { AssignOwner } from "./assign-owner";
import { getMembers, getServerBySlug, getServers } from "@/lib/queries";
import { settingsLimitsFor } from "@/lib/server-ops";
import { isSystemAccount } from "@/lib/system-user";
import { GameSettings } from "./game-settings";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>;
}) {
  const user = await requireUser();
  const { server: slug } = await searchParams;
  const [servers, asked] = await Promise.all([getServers(user), slug ? getServerBySlug(slug, user) : Promise.resolve(null)]);
  const selected = asked ?? (await getServerBySlug(servers[0]?.slug ?? "", user));

  if (!selected) return <NoServers user={shellUser(user)} section="Settings" />;

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

  /* Every account may open this page for every server; only those who
     may change the settings are given a join password, from the panel or
     from the server's files. It used to be in the form of every page, for
     members and moderators of other people's servers alike. */
  const canWrite = can(user, "server.settings.write", selected.ownerId);
  const canDelete = can(user, "server.delete", selected.ownerId);
  const canAssign = can(user, "server.assign", selected.ownerId);
  const privileged = user.role === "OWNER" || user.role === "ADMIN";

  /* Everything this page reads that does not wait on anything else, together: it was some thirty round trips one after another (two for
     each part, and the bucket read and decrypted three times to be compared with null), and the one that asks the node is limited to
     two and a half seconds and skipped for a node the panel knows is away (lib/node-read.ts). */
  const [limits, onNode, dnsFacts, offsite, deletion, members, candidates, moveCounts] = await Promise.all([
    settingsLimitsFor(selected),
    game ? configOnNode(selected, game) : Promise.resolve({ values: {}, read: false }),
    dnsProviderFacts(),
    offsiteTarget(),
    /* Only for whoever may delete it. The Danger zone was drawn for
       every account, with a count of backups the Backups page would
       not list them. */
    canDelete
      ? Promise.all([
          db.backup.count({ where: { serverId: selected.id, store: { not: "S3" }, artifact: { not: null } } }),
          db.backup.count({ where: { serverId: selected.id, store: "S3", artifact: { not: null } } }),
        ])
      : Promise.resolve(null),
    canAssign ? getMembers() : Promise.resolve(null),
    privileged ? moveCandidates(selected, definition) : Promise.resolve(null),
    privileged
      ? Promise.all([
          db.backup.count({ where: { serverId: selected.id, store: { not: "S3" } } }),
          db.backup.count({ where: { serverId: selected.id, store: { not: "S3" }, state: "LOCKED" } }),
        ])
      : Promise.resolve(null),
  ]);

  /* What the panel last wrote, and what the server's files say now. The
     form shows the second where they disagree — the file is what the
     game will actually read — and names what changed underneath it. */
  const stored = game ? currentConfig(game, selected) : {};
  const drift = game ? configDrift(game, stored, onNode.values) : [];
  const shown = game
    ? settingsFor(game, canWrite, { stored, onNode: onNode.values, drift })
    : { stored, onNode: onNode.values, drift, hidden: [] };

  return (
    <AppShell crumbs={[{ label: selected.name, href: `/servers/${selected.slug}` }, "Settings"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <ServerTabs slug={selected.slug} active="settings" gameId={selected.gameId} viewer={user} ownerId={selected.ownerId} />
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
            editable: canWrite,
            dns: dnsFacts,
            deletion: deletion
              ? {
                  localBackups: deletion[0],
                  offsiteBackups: deletion[1],
                  finalBackupBlocked: !runtimeFor(selected.node)
                    ? `${selected.node.name} has no agent, so there is nothing to archive.`
                    : offsite === null
                      ? "No bucket is configured on the Backups page, and a backup on the node would be deleted with it."
                      : null,
                }
              : null,
          }}
        />

        {members && (
          <AssignOwner
            slug={selected.slug}
            name={selected.name}
            owner={{ id: selected.ownerId, name: selected.owner.name, role: "" }}
            members={members.filter((m) => !isSystemAccount(m)).map((m) => ({ id: m.id, name: m.name, role: m.role }))}
          />
        )}

        {candidates && moveCounts && (
          <MoveServer
            slug={selected.slug}
            name={selected.name}
            currentNode={selected.node.name}
            candidates={candidates}
            offsite={offsite !== null}
            running={selected.state === "RUNNING" || selected.state === "UNHEALTHY"}
            localBackups={moveCounts[0]}
            lockedLocal={moveCounts[1]}
          />
        )}

        {privileged && (
          <CopyServer
            slug={selected.slug}
            name={selected.name}
            canCopyWorld={offsite !== null}
            leftBehind={game ? leftBehind(game) : []}
          />
        )}

        {game && (
          /* Keyed on the values it is given for the same reason the form
             above is: a successful save remounts it with fresh values
             and a clean dirty flag. */
          <GameSettings
            key={JSON.stringify({ ...shown.stored, ...shown.onNode })}
            slug={selected.slug}
            gameName={game.name}
            fields={game.config}
            initial={{ ...shown.stored, ...shown.onNode }}
            drift={shown.drift}
            hidden={shown.hidden}
            readOnly={!canWrite}
          />
        )}
      </div>
    </AppShell>
  );
}
