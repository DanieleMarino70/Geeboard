import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AGENT_IMAGE,
  DEFAULT_REGISTRIES,
  canonicalImage,
  normaliseRegistries,
  parseImage,
  registryAllowed,
  registryProblem,
  registryRefusal,
} from "../src/domain/games/image-ref.ts";

/* Which images a manifest may name: pinned by digest, from a registry on the list. */

const D = `sha256:${"ab12".repeat(16)}`;
const ok = (image: string) => {
  const r = parseImage(image);
  assert.ok(r.ok, `${image}: ${r.ok ? "" : r.reason}`);
  return r.ref;
};
const no = (image: unknown) => {
  const r = parseImage(image);
  assert.equal(r.ok, false, String(image));
  return r.ok ? "" : r.reason;
};

test("the registry is found as Docker finds it", () => {
  assert.equal(ok(`factoriotools/factorio@${D}`).registry, "docker.io");
  assert.equal(ok(`alpine@${D}`).registry, "docker.io");
  assert.equal(ok(`docker.io/library/alpine@${D}`).registry, "docker.io");
  assert.equal(ok(`index.docker.io/library/alpine@${D}`).registry, "docker.io");
  assert.equal(ok(`registry-1.docker.io/x/y@${D}`).registry, "docker.io");
  assert.equal(ok(`ghcr.io/owner/repo@${D}`).registry, "ghcr.io");
  assert.equal(ok(`quay.io/org/img:1.2@${D}`).registry, "quay.io");
  assert.equal(ok(`registry.example.com:5000/team/img@${D}`).registry, "registry.example.com:5000");
  assert.equal(ok(`localhost/img@${D}`).registry, "localhost");
  assert.equal(ok(`localhost:5000/img@${D}`).registry, "localhost:5000");
});

test("a Docker Hub official image is in library/, and the others are not", () => {
  assert.equal(ok(`alpine@${D}`).repository, "library/alpine");
  assert.equal(ok(`factoriotools/factorio@${D}`).repository, "factoriotools/factorio");
  assert.equal(ok(`ghcr.io/a/b/c@${D}`).repository, "a/b/c");
});

test("the tag is kept for reading and takes no part in what the image is", () => {
  const a = ok(`factoriotools/factorio:stable@${D}`);
  assert.equal(a.tag, "stable");
  assert.equal(canonicalImage(a), `docker.io/factoriotools/factorio@${D}`);
  assert.equal(canonicalImage(ok(`factoriotools/factorio@${D}`)), canonicalImage(a));
  assert.equal(ok(`registry.example.com:5000/x/y:v1@${D}`).tag, "v1", "a port in the host is not a tag");
  assert.equal(ok(`registry.example.com:5000/x/y@${D}`).tag, null);
});

test("an image with no digest is refused, and says what to add", () => {
  for (const image of ["alpine", "alpine:latest", "factoriotools/factorio:stable", "ghcr.io/o/r:1.0", "ghcr.io/o/r"]) {
    assert.match(no(image), /no digest/, image);
  }
  assert.match(no("alpine:latest"), /@sha256:/);
});

test("a digest that is not a full sha256 is refused", () => {
  for (const digest of ["sha256:abc", `sha256:${"a".repeat(63)}`, `sha256:${"a".repeat(65)}`, `sha256:${"A".repeat(64)}`, `sha512:${"a".repeat(64)}`, `md5:${"a".repeat(32)}`, `sha256:${"g".repeat(64)}`]) {
    const r = parseImage(`alpine@${digest}`);
    assert.equal(r.ok, false, digest);
  }
});

test("what could be taken for something else is refused: flags, traversal, spaces, shell, case", () => {
  for (const image of [
    `-v/:/host@${D}`,
    `--privileged@${D}`,
    `a/../b@${D}`,
    `alpine @${D}`,
    ` alpine@${D}`,
    `alpine@${D} `,
    `Alpine@${D}`,
    `ghcr.io/Owner/Repo@${D}`,
    `alpine;rm -rf /@${D}`,
    `$(id)@${D}`,
    `alpine\n@${D}`,
    `[::1]:5000/x@${D}`,
    `user@host/x@${D}`,
    `http://ghcr.io/x@${D}`,
    `//x@${D}`,
    `a//b@${D}`,
    `/x@${D}`,
    `x/@${D}`,
    `@${D}`,
    "",
    "   ",
    `${"a".repeat(260)}@${D}`,
  ]) {
    assert.equal(parseImage(image).ok, false, JSON.stringify(image));
  }
  for (const value of [null, undefined, 5, {}, [], true]) no(value);
});

test("every reference accepted here is one the agent accepts", () => {
  for (const image of [`alpine@${D}`, `ghcr.io/o/r:v1.2.3@${D}`, `registry.example.com:5000/a/b-c_d.e@${D}`, `localhost:5000/img@${D}`, `quay.io/org/img__x@${D}`]) {
    assert.ok(AGENT_IMAGE.test(image), image);
    assert.ok(parseImage(image).ok, image);
  }
});

test("the copy of the agent's pattern is the agent's pattern", { skip: !existsSync(new URL("../../daemon/src/provision.ts", import.meta.url)) && "daemon/ is not here" }, () => {
  const source = readFileSync(new URL("../../daemon/src/provision.ts", import.meta.url), "utf8");
  const found = /const IMAGE =\s*\n?\s*(\/\^[^\n]+\$\/);/.exec(source);
  assert.ok(found, "daemon/src/provision.ts says what IMAGE is");
  assert.equal(found[1], String(AGENT_IMAGE));
});

test("the list is compared in normal form, and Docker Hub is one place however it is written", () => {
  const ref = ok(`alpine@${D}`);
  assert.equal(registryAllowed(ref, DEFAULT_REGISTRIES), true);
  assert.equal(registryAllowed(ref, ["index.docker.io"]), true);
  assert.equal(registryAllowed(ref, ["  DOCKER.IO "]), true);
  assert.equal(registryAllowed(ref, ["ghcr.io"]), false);
  assert.equal(registryAllowed(ref, []), false);
  assert.equal(registryAllowed(ok(`ghcr.io/o/r@${D}`), DEFAULT_REGISTRIES), true);
  assert.equal(registryAllowed(ok(`quay.io/o/r@${D}`), DEFAULT_REGISTRIES), false);
  assert.equal(registryAllowed(ok(`ghcr.io.evil.example/o/r@${D}`), DEFAULT_REGISTRIES), false, "a host that starts like an allowed one is another host");
  assert.equal(registryAllowed(ok(`evil.example/ghcr.io/r@${D}`), DEFAULT_REGISTRIES), false, "an allowed name in the path is not the registry");
  assert.deepEqual(normaliseRegistries(["Docker.io", "index.docker.io", " ghcr.io ", ""]), ["docker.io", "ghcr.io"]);
  assert.match(registryRefusal(ok(`quay.io/o/r@${D}`), DEFAULT_REGISTRIES), /quay\.io is not on this workspace's list \(docker\.io, ghcr\.io\)/);
});

test("a registry that may join the list is a host name, nothing more", () => {
  for (const host of ["quay.io", "registry.gitlab.com", "registry.example.com:5000", "Docker.IO", "localhost:5000"]) assert.equal(registryProblem(host), null, host);
  for (const host of ["", " ", "x/y", "https://quay.io", "quay.io/", "a b", "-x.io", "x_y.io", "a".repeat(130), "[::1]", "quay.io:99999x"]) {
    assert.notEqual(registryProblem(host), null, JSON.stringify(host));
  }
});
