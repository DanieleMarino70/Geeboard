/* Which container images a manifest may name.

   The agent builds a container from whatever image the panel hands it: any
   registry, any tag, no digest (measured, 0.6.0 Part 0). So the rules about
   images live here, in the panel, and they are two:

     pinned     an image is `registry/name[:tag]@sha256:<64 hex>`. A tag moves; a
                digest is the bytes. An owner approves the bytes they were shown,
                and an image that changes under an approval is not a thing a tag
                can be allowed to do. A reference without a digest, `latest`
                included, is refused.
     sourced    its registry is one of the workspace's list (default docker.io
                and ghcr.io). The host is worked out as Docker works it out, so
                `x`, `docker.io/library/x` and `index.docker.io/x` are one place.

   The panel never asks a registry anything: the digest is brought by whoever
   wrote the manifest (`docker buildx imagetools inspect <image>`, the index
   digest for a multi-architecture image).

   `AGENT_IMAGE` is the agent's own pattern, copied: every reference accepted
   here has to be one the agent accepts, or an approved game would fail at the
   first create. A test reads the agent's source and holds the two equal. */

export const AGENT_IMAGE =
  /^[a-z0-9][a-z0-9._-]*(?::[0-9]+)?(?:\/[a-z0-9][a-z0-9._-]*)*(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[a-f0-9]{64})?$/;

export const DEFAULT_REGISTRIES: readonly string[] = ["docker.io", "ghcr.io"];

/* Docker Hub's other names for itself. */
const HUB_ALIASES = new Set(["docker.io", "index.docker.io", "registry-1.docker.io", "registry.hub.docker.com"]);

export interface ImageRef {
  /** Normalised: `docker.io` for Docker Hub, lower case. */
  registry: string;
  /** The repository, with `library/` supplied for a Hub official image. */
  repository: string;
  tag: string | null;
  /** `sha256:` and 64 hex. */
  digest: string;
}

export type ImageResult = { ok: true; ref: ImageRef } | { ok: false; reason: string };

const COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[0-9]{1,5})?$/;

/** The registry a normalised host stands for, as people name it: `docker.io`. */
export function normaliseRegistry(raw: string): string {
  const host = raw.trim().toLowerCase();
  return HUB_ALIASES.has(host) ? "docker.io" : host;
}

export function parseImage(value: unknown): ImageResult {
  if (typeof value !== "string") return { ok: false, reason: "an image is text" };
  const text = value.trim();
  if (text.length === 0) return { ok: false, reason: "the image is empty" };
  if (text.length > 255) return { ok: false, reason: "the image is longer than 255 characters" };
  if (text !== value) return { ok: false, reason: "the image has spaces around it" };
  const NOT_AN_IMAGE = "that is not an image reference the node will accept";

  const at = text.indexOf("@");
  if (at < 0) {
    return {
      ok: false,
      reason: AGENT_IMAGE.test(text) && !text.includes("..")
        ? "the image has no digest: it has to end in @sha256: and 64 hex characters, so that what runs is what was approved and a tag cannot move under it"
        : NOT_AN_IMAGE,
    };
  }
  const digest = text.slice(at + 1);
  if (!DIGEST.test(digest)) return { ok: false, reason: "the digest is not sha256: followed by 64 lower-case hex characters" };
  if (!AGENT_IMAGE.test(text) || text.includes("..")) return { ok: false, reason: NOT_AN_IMAGE };
  let name = text.slice(0, at);

  let tag: string | null = null;
  const lastSlash = name.lastIndexOf("/");
  const colon = name.lastIndexOf(":");
  if (colon > lastSlash) {
    tag = name.slice(colon + 1);
    name = name.slice(0, colon);
    if (!TAG.test(tag)) return { ok: false, reason: "the tag is not a valid tag" };
  }

  const parts = name.split("/");
  let registry = "docker.io";
  // Docker's own rule: the first part is a registry if it holds a dot or a colon, or is `localhost`.
  if (parts.length > 1 && (/[.:]/.test(parts[0]!) || parts[0] === "localhost")) {
    registry = normaliseRegistry(parts.shift()!);
    if (!HOST.test(registry)) return { ok: false, reason: "the registry's name is not a host name" };
  }
  if (parts.length === 0 || parts.some((p) => !COMPONENT.test(p))) return { ok: false, reason: "the repository's name is not a valid one" };
  if (registry === "docker.io" && parts.length === 1) parts.unshift("library");
  return { ok: true, ref: { registry, repository: parts.join("/"), tag, digest } };
}

/** `registry/repository@digest`, without the tag: what the image is, whatever it is called. */
export function canonicalImage(ref: ImageRef): string {
  return `${ref.registry}/${ref.repository}@${ref.digest}`;
}

/** The workspace's list as it is compared: trimmed, lower case, Docker Hub's aliases folded, no duplicates. */
export function normaliseRegistries(list: readonly string[]): string[] {
  return [...new Set(list.map(normaliseRegistry).filter((r) => r.length > 0))];
}

/** Whether an image's registry is on the list. The list is compared in normalised form. */
export function registryAllowed(ref: ImageRef, registries: readonly string[]): boolean {
  return normaliseRegistries(registries).includes(ref.registry);
}

/** Null when `host` may be added to the list, or why not. A registry is a host name, optionally with a port. */
export function registryProblem(raw: string): string | null {
  const host = normaliseRegistry(raw);
  if (host.length === 0) return "A registry is a host name, like ghcr.io.";
  if (host.length > 120) return "That registry's name is too long.";
  if (!HOST.test(host)) return "A registry is a host name, like ghcr.io or registry.example.com:5000.";
  return null;
}

/** The sentence an owner reads when an image is refused for its registry. */
export function registryRefusal(ref: ImageRef, registries: readonly string[]): string {
  return `the registry ${ref.registry} is not on this workspace's list (${normaliseRegistries(registries).join(", ") || "empty"})`;
}
