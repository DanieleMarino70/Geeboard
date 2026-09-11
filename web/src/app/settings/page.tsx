import Link from "next/link";
import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { findGame } from "@/domain/games/registry";
import { currentConfig } from "@/lib/config-ops";
import { getServerBySlug, getServers } from "@/lib/queries";
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

  if (!selected) {
    return (
      <AppShell crumbs={["Ashfold", "Settings"]} user={user}>
        <div className="grid min-h-[60vh] place-items-center px-5 sm:px-8">
          <p className="max-w-[36ch] text-center text-[12.5px] leading-relaxed text-ink-4">
            There are no servers to configure yet. Create one and its settings appear here.
          </p>
        </div>
      </AppShell>
    );
  }

  /* The game's own settings, generated from its definition. A server
     that predates the catalog has no definition to generate from, and
     gets the platform settings only. */
  const game = selected.gameId ? findGame(selected.gameId) : undefined;

  return (
    <AppShell crumbs={["Ashfold", selected.name, "Settings"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        {servers.length > 1 && (
          <div className="inline-flex w-fit gap-px rounded-[9px] bg-(--border) p-px">
            {servers.map((s) => (
              <Link
                key={s.id}
                href={`/settings?server=${s.slug}`}
                className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                  s.slug === selected.slug ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}

        {/* Keyed on the saved values: a successful save changes the key,
            remounting the form with fresh defaults and a clean dirty flag. */}
        <SettingsForm
          key={[
            selected.name,
            selected.host,
            selected.motd,
            selected.javaFlags,
            selected.memoryLimit,
            selected.cpuLimit,
            selected.autosave,
            selected.whitelist,
            selected.restartPolicy,
            selected.maxRestarts,
          ].join("|")}
          server={{
            slug: selected.slug,
            name: selected.name,
            host: selected.host,
            port: selected.port,
            motd: selected.motd ?? "",
            javaFlags: selected.javaFlags ?? "",
            memoryLimit: selected.memoryLimit,
            cpuLimit: selected.cpuLimit,
            autosave: selected.autosave,
            whitelist: selected.whitelist,
            restartPolicy: selected.restartPolicy,
            maxRestarts: selected.maxRestarts,
            version: selected.version,
            node: selected.node.name,
            worldSize: selected.worldSize,
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
