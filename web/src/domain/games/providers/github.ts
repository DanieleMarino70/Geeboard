import type { GameDefinition, VersionSourceRef } from "../types";
import type { IGameVersionProvider, ProviderOptions, VersionCandidate } from "../versions";
import { getJson } from "./http";

/* GitHub releases.

   For the games whose server is published as a release rather than
   through Steam — TShock is the one shipped so far.

   Unauthenticated, which caps this at 60 requests an hour from one IP.
   That is ample given the catalog is refreshed by a sync rather than by
   a page render, and it is why the cache in http.ts is not optional. */

interface Release {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
}

const PER_PAGE = 30;

export function githubProvider(
  ref: Extract<VersionSourceRef, { provider: "github" }>,
  options: ProviderOptions = {},
): IGameVersionProvider {
  const match = ref.match ? new RegExp(ref.match) : null;

  return {
    id: "github",

    async list(game: GameDefinition): Promise<VersionCandidate[]> {
      const releases = await getJson<Release[]>(
        `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases?per_page=${PER_PAGE}`,
        options,
        { headers: { accept: "application/vnd.github+json" } },
      );

      if (!Array.isArray(releases)) return [];

      return releases
        // A draft is not published; a caller cannot install one.
        .filter((r) => r.draft !== true && typeof r.tag_name === "string")
        .filter((r) => (match ? match.test(r.tag_name!) : true))
        .map((release) => {
          const tag = release.tag_name!;
          const upstream = numeric(tag);

          return {
            id: `gh-${slug(tag)}`,
            label: release.name?.trim() || tag,
            upstream,
            note: `${ref.owner}/${ref.repo} ${tag}`,
            released: release.published_at?.slice(0, 10),
            channel: release.prerelease === true ? ("preview" as const) : ("stable" as const),
            recommended: false,
            /* Listed, not installable. A release tells us a version
               exists; what runs it is the definition's business, and
               without an image or a download there is nothing to
               install. A definition that wants one installable declares
               it statically — which then wins on id, and this row
               contributes only the fact that upstream has moved. */
            supported: false,
            providerId: "github",
          } satisfies VersionCandidate;
        })
        .filter((c) => c.upstream !== undefined || game.versions.length === 0);
    },

    /* The newest published release is the best available answer to "what
       has upstream got?", which is a different question from "what can
       we install?" — see versions.ts. */
    async latestUpstream() {
      const releases = await getJson<Release[]>(
        `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases?per_page=${PER_PAGE}`,
        options,
        { headers: { accept: "application/vnd.github+json" } },
      );
      if (!Array.isArray(releases)) return null;

      const newest = releases
        .filter((r) => r.draft !== true && r.prerelease !== true && r.tag_name)
        .filter((r) => (match ? match.test(r.tag_name!) : true))[0];

      const upstream = newest?.tag_name ? numeric(newest.tag_name) : undefined;
      return upstream ? { server: upstream } : null;
    },
  };
}

/* Tags are written every way there is — v1.4.4.9, 1.4.4.9, release-1.2.
   The version is the dotted number inside; anything without one is left
   alone rather than mangled into a comparison it would lose. */
function numeric(tag: string): string | undefined {
  const found = /\d+(?:\.\d+)+/.exec(tag);
  return found?.[0];
}

function slug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
