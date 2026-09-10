import type { GameDefinition, VersionSourceRef } from "../types";
import type { IGameVersionProvider, ProviderOptions, VersionCandidate } from "../versions";
import { getJson, type FetchOptions } from "./http";

/* Steam.

   Steam has no version numbers. It has **branches** — `public`,
   `unstable`, a beta somebody left lying around — and each branch has a
   **build id**, an integer that goes up whenever the depot changes.

   This matters more than it sounds. Rust has no version number at all;
   the only way to know a Rust server is out of date is that its branch's
   build id has moved. Treating a build id as a version would be worse
   than useless: 17851234 would sort above every real version string a
   game ever had.

   So build ids never become versions here. They decorate the version
   that tracks the branch, via `steamBranch` in the definition, and the
   resolver keeps them in their own field all the way to the UI. */

interface SteamCmdResponse {
  status?: string;
  data?: Record<
    string,
    {
      depots?: {
        branches?: Record<
          string,
          { buildid?: string | number; timeupdated?: string | number; description?: string }
        >;
      };
    }
  >;
}

/* api.steamcmd.net mirrors what `steamcmd +app_info_print` returns,
   without needing SteamCMD installed or a login. Anonymous, and the only
   public source for a dedicated server app's build ids. */
const ENDPOINT = "https://api.steamcmd.net/v1/info";

export interface SteamBranch {
  branch: string;
  buildId: string;
  updatedAt: string | null;
  description: string | null;
}

/** The branches an app currently publishes, newest build first. */
export async function steamBranches(
  appId: number,
  options: FetchOptions = {},
): Promise<SteamBranch[]> {
  const body = await getJson<SteamCmdResponse>(`${ENDPOINT}/${appId}`, options);
  const branches = body.data?.[String(appId)]?.depots?.branches;
  if (!branches) return [];

  return Object.entries(branches)
    .map(([branch, info]) => ({
      branch,
      buildId: String(info.buildid ?? ""),
      updatedAt: toIso(info.timeupdated),
      description: typeof info.description === "string" ? info.description : null,
    }))
    .filter((b) => b.buildId.length > 0)
    .sort((a, b) => Number(b.buildId) - Number(a.buildId));
}

export function steamProvider(
  ref: Extract<VersionSourceRef, { provider: "steam" }>,
  options: ProviderOptions = {},
): IGameVersionProvider {
  return {
    id: "steam",

    async list(game: GameDefinition): Promise<VersionCandidate[]> {
      const branches = await steamBranches(ref.appId, options);

      /* Which branches are worth listing: the ones the definition names
         explicitly, or the ones a static version already tracks. A game
         with a beta branch nobody has written a definition for does not
         suddenly gain an installable version. */
      const wanted = new Set(
        ref.branches ?? game.versions.map((v) => v.steamBranch).filter((b): b is string => !!b),
      );

      return branches
        .filter((b) => wanted.size === 0 || wanted.has(b.branch))
        .map((b) => ({
          id: `steam-${b.branch}`,
          label: `${game.name} · ${b.branch}`,
          /* Deliberately no `upstream`. A build id is not a version, and
             letting it into that field would corrupt every comparison
             the resolver makes. */
          branch: b.branch,
          buildId: b.buildId,
          updatedAt: b.updatedAt,
          note: b.description ?? `Steam branch ${b.branch}`,
          released: b.updatedAt?.slice(0, 10),
          channel: b.branch === "public" ? ("stable" as const) : ("preview" as const),
          recommended: false,
          /* Not installable on its own: a branch is something a version
             tracks, not something to put on a server. A definition that
             wants it installable declares a version with that
             `steamBranch`, and the resolver merges the two. */
          supported: false,
          providerId: "steam",
        }));
    },
  };
}

/* Steam's timestamps are unix seconds, sometimes as a string. Anything
   that does not parse is dropped rather than guessed at — a wrong date
   on a version list is worse than a missing one. */
function toIso(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
