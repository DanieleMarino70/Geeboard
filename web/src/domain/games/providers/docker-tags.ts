import { PlatformError } from "../../errors";
import { REPOSITORY, type TagRecord } from "../followed";
import { getJson, type FetchOptions } from "./http";

/* The tags of an image on Docker Hub.

   Not a version provider in the sense of versions.ts: it lists no candidates, and a game does not name it in its
   `versionSources`. What a tag becomes is decided by followed.ts from the definition's own rules, and what this
   returns is only the raw list — the repository's most recently pushed tags, which is where a release newer than
   the definition ships has to be.

   One page of a hundred, newest first. A repository whose hundred latest pushes are all older than the definition's
   own versions has nothing to add, so a second page would only be asking for tags that cannot matter. */

interface HubPage {
  results?: Array<{ name?: unknown; last_updated?: unknown; tag_status?: unknown }>;
}

const HUB = "https://hub.docker.com/v2/repositories";

export async function listTags(repository: string, options: FetchOptions = {}): Promise<TagRecord[]> {
  // The name goes into an address: a definition that holds anything but a repository is refused before it does.
  if (!REPOSITORY.test(repository)) {
    throw new PlatformError("VERSION_PROVIDER_FAILED", `"${repository}" is not a Docker Hub repository.`);
  }

  const page = await getJson<HubPage>(`${HUB}/${repository}/tags?page_size=100&ordering=last_updated`, options);
  if (!Array.isArray(page?.results)) {
    throw new PlatformError("VERSION_PROVIDER_FAILED", "hub.docker.com did not return a list of tags");
  }

  const tags: TagRecord[] = [];
  for (const entry of page.results) {
    if (typeof entry?.name !== "string" || entry.name.length === 0 || entry.name.length > 128) continue;
    // A tag the registry has marked inactive is not pulled by anybody any more.
    if (typeof entry.tag_status === "string" && entry.tag_status !== "active") continue;
    const pushedAt = typeof entry.last_updated === "string" && !Number.isNaN(Date.parse(entry.last_updated)) ? entry.last_updated : null;
    tags.push({ name: entry.name, pushedAt });
  }
  return tags;
}
