import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { PROJECT_ZOMBOID } from "../src/domain/games/definitions/project-zomboid.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { acceptFollowed, followProblems, followedVersions, type TagRecord } from "../src/domain/games/followed.ts";
import { listTags } from "../src/domain/games/providers/docker-tags.ts";
import { clearVersionCache } from "../src/domain/games/providers/http.ts";
import { findVersion, requireGame, setFollowedVersions } from "../src/domain/games/registry.ts";
import { outlookFor, resolveVersions, updateTargetFor } from "../src/domain/games/versions.ts";

/* Project Zomboid updates every few weeks and its image's maker publishes each release as a tag. The panel said "update available"
   (Steam had moved) while no version named the tag that carries it, and an update re-pulled the pinned one: 42.21 was out, and a
   server stayed on 42.20.4. These are the rules that find the tag, and the ones that keep a tag from being trusted more than the
   definition trusts the tag it pins.

   No network: the registry is a stub of `fetch`, and a list of tags is a list. */

const REPO = "danixu86/project-zomboid-dedicated-server";
const at = (name: string, pushedAt: string | null = "2026-10-01T12:25:05.764717Z"): TagRecord => ({ name, pushedAt });

// What Docker Hub listed for the image on 2026-10-08.
const HUB = [
  at("latest"),
  at("latest-release"),
  at("42.21-release-2", "2026-10-01T12:25:05.764717Z"),
  at("42.21-release", "2026-09-29T12:08:54.362719Z"),
  at("latest-unstable", "2026-09-23T21:07:45.340984Z"),
  at("42.21-unstable", "2026-09-23T21:07:42.541581Z"),
  at("42.20.4-release", "2026-08-26T12:49:36.556805Z"),
  at("42.20.3-release", "2026-08-18T06:42:39.132013Z"),
  at("41.78.19-release", "2026-04-09T02:07:24.928472Z"),
];

afterEach(() => setFollowedVersions({}));

test("the release the registry lists and the definition does not ship becomes a version of its line, on the newest build of it", () => {
  const found = followedVersions(PROJECT_ZOMBOID, HUB);
  assert.deepEqual(found.map((v) => v.id), ["b42-42-21"]);

  const [v] = found;
  assert.equal(v!.image, `${REPO}:42.21-release-2`);
  assert.equal(v!.upstream, "42.21");
  assert.equal(v!.line, "b42");
  assert.equal(v!.label, "Build 42 · 42.21");
  assert.equal(v!.released, "2026-10-01");
  assert.equal(v!.followed, true);
  assert.equal(v!.supported, true);
  // What the version it is made from says about how to run: its Steam branch, its channel.
  assert.equal(v!.steamBranch, "public");
  assert.equal(v!.channel, "stable");
  assert.equal(v!.recommended, true);
});

test("a tag that is not a release, or not newer than the definition, adds nothing", () => {
  // `latest-*` moves, `-unstable` is a branch that is gone, and 42.20.4 and 41.78.19 are what the definition ships.
  assert.deepEqual(followedVersions(PROJECT_ZOMBOID, HUB.filter((t) => !t.name.startsWith("42.21-release"))), []);
  assert.deepEqual(followedVersions(PROJECT_ZOMBOID, []), []);
});

test("one build of a version is enough, and a rebuild beats the first build whichever the registry lists first", () => {
  assert.equal(followedVersions(PROJECT_ZOMBOID, [at("42.21-release")])[0]!.image, `${REPO}:42.21-release`);
  assert.equal(followedVersions(PROJECT_ZOMBOID, [at("42.21-release"), at("42.21-release-2")])[0]!.image, `${REPO}:42.21-release-2`);
  assert.equal(followedVersions(PROJECT_ZOMBOID, [at("42.21-release-2"), at("42.21-release-10"), at("42.21-release-3")])[0]!.image, `${REPO}:42.21-release-10`);
});

test("two releases are two versions, newest first, and only the newest is the one a new server starts on", () => {
  const found = followedVersions(PROJECT_ZOMBOID, [at("42.21-release"), at("42.22.1-release"), at("42.22-release")]);
  assert.deepEqual(found.map((v) => v.upstream), ["42.22.1", "42.22", "42.21"]);
  assert.deepEqual(found.map((v) => v.recommended === true), [true, false, false]);
  // The Steam branch is the newest build's, and only its.
  assert.deepEqual(found.map((v) => v.steamBranch), ["public", undefined, undefined]);
});

test("a tag the pattern does not accept is not a version, whatever it says", () => {
  const hostile = ["42.99-release; rm -rf /", "42.99-release\n", "../42.99-release", "42.99.x-release", "42-release", "42.21-release-99999999999999999999", "42.21-releases", " 42.21-release", "99.1-release", "42.21-release-"];
  assert.deepEqual(followedVersions(PROJECT_ZOMBOID, hostile.map((name) => at(name))), []);
});

test("a game that follows nothing adds nothing", () => {
  assert.deepEqual(followedVersions(TERRARIA, [at("1.4.5.0")]), []);
});

test("the registry hands the game its followed versions, in front of the one they were made from, and moves `recommended` to the newest", () => {
  const before = requireGame("project-zomboid");
  assert.equal(before.versions.some((v) => v.followed), false);
  assert.equal(before.versions.find((v) => v.recommended)?.id, "b42");

  setFollowedVersions({ "project-zomboid": followedVersions(PROJECT_ZOMBOID, HUB) });
  const game = requireGame("project-zomboid");
  assert.deepEqual(game.versions.map((v) => v.id), ["b42-42-21", "b42", "b41", "b42-unstable"]);
  assert.deepEqual(game.versions.filter((v) => v.recommended).map((v) => v.id), ["b42-42-21"]);
  // The public branch belongs to the newest build of its line; 42.20.4 does not carry its build id or its date any more.
  assert.deepEqual(game.versions.filter((v) => v.steamBranch === "public").map((v) => v.id), ["b42-42-21"]);
  assert.equal(game.versions.find((v) => v.id === "b41")?.steamBranch, "legacy41");
  assert.equal(findVersion(game, "b42-42-21")?.image, `${REPO}:42.21-release-2`);
  // The definition itself is not touched.
  assert.equal(PROJECT_ZOMBOID.versions.find((v) => v.id === "b42")?.recommended, true);
  assert.equal(PROJECT_ZOMBOID.versions.find((v) => v.id === "b42")?.steamBranch, "public");
  assert.equal(PROJECT_ZOMBOID.versions.some((v) => v.followed), false);
  // Asked again, the same object: a page does not rebuild it on every render.
  assert.equal(requireGame("project-zomboid"), game);

  setFollowedVersions({});
  assert.equal(requireGame("project-zomboid").versions.some((v) => v.followed), false);
});

test("a server on 42.20.4 is offered 42.21, a build 41 server is not, and the update is the registry's tag", async () => {
  setFollowedVersions({ "project-zomboid": followedVersions(PROJECT_ZOMBOID, HUB) });
  const catalog = await resolveVersions(requireGame("project-zomboid"));

  const target = updateTargetFor(catalog, "b42");
  assert.equal(target?.id, "b42-42-21");
  assert.equal(target?.image, `${REPO}:42.21-release-2`);
  assert.equal(target?.providerId, "registry", "it is a registry's word, not the definition's");
  assert.equal(outlookFor(catalog, "b42").updateTo?.upstream, "42.21");
  assert.equal(updateTargetFor(catalog, "b41"), null);
  // Already on it: nothing newer.
  assert.equal(updateTargetFor(catalog, "b42-42-21"), null);
  assert.equal(catalog.recommended?.id, "b42-42-21");
  assert.equal(catalog.supportedLatest?.id, "b42-42-21");
});

test("what a process is handed is read through the definition's rules: another repository, another game and a shipped id are dropped", () => {
  const good = followedVersions(PROJECT_ZOMBOID, HUB)[0]!;
  const elsewhere = { ...good, id: "b42-42-30", image: "someone/else:42.30-release" };
  const sneaky = { ...good, id: "b42-42-31", image: `${REPO}-fork:42.31-release` };
  const shipped = { ...good, id: "b42" };
  const unflagged = { ...good, id: "b42-42-32", followed: undefined } as unknown as typeof good;
  const noLine = { ...good, id: "b42-42-33", line: "b40" };
  const notAnImage = { ...good, id: "b42-42-34", image: 7 } as unknown as typeof good;

  assert.deepEqual(acceptFollowed(PROJECT_ZOMBOID, [good, elsewhere, sneaky, shipped, unflagged, noLine, notAnImage, good]).map((v) => v.id), ["b42-42-21"]);
  assert.deepEqual(acceptFollowed(TERRARIA, [good]), [], "a game that follows nothing");

  setFollowedVersions({ "project-zomboid": [good, elsewhere, shipped], terraria: [good], "community-x": [good] });
  assert.deepEqual(requireGame("project-zomboid").versions.filter((v) => v.followed).map((v) => v.id), ["b42-42-21"]);
  assert.equal(requireGame("terraria").versions.some((v) => v.followed), false);
});

test("a follow rule that names no repository, no line or no version group is a mistake the audit reports", () => {
  assert.deepEqual(auditDefinition(PROJECT_ZOMBOID), []);
  const rule = PROJECT_ZOMBOID.followTags!;
  const problems = (follow: typeof rule) => followProblems(PROJECT_ZOMBOID, follow).join(" | ");

  assert.match(problems({ ...rule, repository: "../../etc" }), /not a Docker Hub repository/);
  assert.match(problems({ ...rule, repository: "someone/else" }), /is in danixu86\/project-zomboid-dedicated-server, not in someone\/else/);
  assert.match(problems({ ...rule, lines: [] }), /follows no line/);
  assert.match(problems({ ...rule, lines: [{ line: "b43", tag: "(?<version>43\\.\\d+)" }] }), /line "b43", which has no version/);
  assert.match(problems({ ...rule, lines: [{ line: "b42", tag: "42\\.\\d+" }] }), /no \(\?<version>…\) group/);
  assert.match(problems({ ...rule, lines: [{ line: "b42", tag: "(" }] }), /not a regular expression/);
  assert.match(problems({ ...rule, lines: [rule.lines[0]!, rule.lines[0]!] }), /twice/);
  // The unstable branch has no version of a line that is installed: it can never be followed by mistake.
  assert.match(problems({ ...rule, lines: [{ line: "b42-unstable", tag: "(?<version>42\\.\\d+)-unstable" }] }), /b42-unstable/);
});

/* ── The registry's answer ────────────────────────────────────────── */

function hub(body: unknown, status = 200) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = real) };
}

test("the tags come from the repository's own page of Docker Hub, newest first, and only the active ones with a plausible name", async () => {
  clearVersionCache();
  const stub = hub({
    results: [
      { name: "42.21-release-2", last_updated: "2026-10-01T12:25:05.764717Z", tag_status: "active" },
      { name: "42.21-release", last_updated: "yesterday", tag_status: "active" },
      { name: "42.20.4-release", last_updated: "2026-08-26T12:49:36.556805Z", tag_status: "inactive" },
      { name: 7 },
      { name: "" },
      { name: "x".repeat(129) },
      null,
    ],
  });
  try {
    const tags = await listTags(REPO, { refresh: true });
    assert.deepEqual(stub.calls, [`https://hub.docker.com/v2/repositories/${REPO}/tags?page_size=100&ordering=last_updated`]);
    assert.deepEqual(tags, [
      { name: "42.21-release-2", pushedAt: "2026-10-01T12:25:05.764717Z" },
      { name: "42.21-release", pushedAt: null },
    ]);
  } finally {
    stub.restore();
  }
});

test("a repository name is checked before it goes into an address, and an answer that is not a list of tags is an error", async () => {
  clearVersionCache();
  const stub = hub({ results: [] });
  try {
    for (const bad of ["../../x", "a/b/c", "owner/name?x=1", "owner", "OWNER/name", "owner/na me"]) {
      await assert.rejects(() => listTags(bad, { refresh: true }), /not a Docker Hub repository/, bad);
    }
    assert.deepEqual(stub.calls, []);
  } finally {
    stub.restore();
  }

  const odd = hub({ detail: "nope" });
  try {
    await assert.rejects(() => listTags(REPO, { refresh: true }), /did not return a list of tags/);
  } finally {
    odd.restore();
  }

  const down = hub({}, 503);
  try {
    await assert.rejects(() => listTags(REPO, { refresh: true }), /answered 503/);
  } finally {
    down.restore();
  }
});
