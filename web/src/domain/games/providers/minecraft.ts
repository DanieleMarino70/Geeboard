import type { VersionSourceRef } from "../types";
import type { IGameVersionProvider, ProviderOptions, VersionCandidate } from "../versions";
import { getJson } from "./http";

/* Mojang's version manifest.

   The cleanest of the three sources: a single JSON document listing
   every Minecraft version ever released, with its type and release date,
   and a `latest` block naming the current release and snapshot.

   It answers the question the other providers cannot: what the *game*
   is on, as distinct from what a server build exists for. Paper and
   Purpur follow Mojang by days or weeks, so a panel that only knew about
   Paper would report a server as current on the day 1.21.5 shipped. */

interface Manifest {
  latest?: { release?: string; snapshot?: string };
  versions?: Array<{
    id?: string;
    type?: string;
    releaseTime?: string;
  }>;
}

const MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

/* Enough to cover anything an operator might still be running, without
   listing a decade of versions nobody will pick from a dropdown. */
const LIMIT = 40;

export function minecraftProvider(
  ref: Extract<VersionSourceRef, { provider: "minecraft-launcher" }>,
  options: ProviderOptions = {},
): IGameVersionProvider {
  const types = new Set(ref.types ?? ["release"]);

  return {
    id: "minecraft-launcher",

    async list(): Promise<VersionCandidate[]> {
      const manifest = await getJson<Manifest>(MANIFEST, options);
      const versions = manifest.versions ?? [];

      return versions
        .filter((v) => v.id && v.type && types.has(v.type as "release" | "snapshot"))
        .slice(0, LIMIT)
        .map((v) => ({
          id: `mojang-${v.id!.replace(/[^A-Za-z0-9.-]/g, "-")}`,
          label: `Minecraft ${v.id}`,
          upstream: v.id,
          note: "Mojang release",
          released: v.releaseTime?.slice(0, 10),
          channel: v.type === "snapshot" ? ("snapshot" as const) : ("stable" as const),
          recommended: false,
          /* Listed so the panel knows the version exists; not
             installable, because which server build runs it — Paper,
             Purpur, vanilla — is the definition's decision and not
             something a manifest can answer. */
          supported: false,
          providerId: "minecraft-launcher",
        }));
    },

    /* The distinction this provider exists for. `game` is what Mojang
       has shipped; there is no separate dedicated-server number for
       Minecraft, so `server` is deliberately left unsaid rather than
       guessed at. */
    async latestUpstream() {
      const manifest = await getJson<Manifest>(MANIFEST, options);
      const release = manifest.latest?.release;
      return release ? { game: release } : null;
    },
  };
}
