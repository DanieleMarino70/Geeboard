import assert from "node:assert/strict";
import { test } from "node:test";
import { requireGame } from "../src/domain/games/registry.ts";
import {
  compareVersions,
  outlookFor,
  registerVersionProvider,
  resolveVersions,
  summariseCatalog,
  type VersionCandidate,
} from "../src/domain/games/versions.ts";

/* Version providers, and the one thing they must never do: let a Steam
   build id be mistaken for a version number.

   No network here. A provider is a function returning candidates, so a
   stub is the whole test surface — and what is being tested is the
   resolver's arithmetic, not Steam's uptime. */

function stubProvider(name: string, candidates: VersionCandidate[]) {
  registerVersionProvider(name, () => ({
    id: name,
    async list() {
      return candidates;
    },
  }));
}

function branch(name: string, buildId: string, updatedAt: string): VersionCandidate {
  return {
    id: `steam-${name}`,
    label: `branch ${name}`,
    branch: name,
    buildId,
    updatedAt,
    released: updatedAt.slice(0, 10),
    channel: name === "public" ? "stable" : "preview",
    recommended: false,
    supported: false,
    providerId: "steam",
  };
}

test("a build id decorates the version that tracks its branch", async () => {
  stubProvider("steam", [
    branch("public", "17851234", "2026-09-01T10:00:00.000Z"),
    branch("unstable", "17999000", "2026-09-08T10:00:00.000Z"),
  ]);

  const catalog = await resolveVersions(requireGame("project-zomboid"));

  const stable = catalog.candidates.find((c) => c.id === "b41-stable")!;
  assert.equal(stable.branch, "public");
  assert.equal(stable.buildId, "17851234");
  // The branch's own row is gone: it was never a version.
  assert.equal(catalog.candidates.some((c) => c.id === "steam-public"), false);

  const unstable = catalog.candidates.find((c) => c.id === "b42-unstable")!;
  assert.equal(unstable.buildId, "17999000");
});

test("a build id never becomes a version, however much larger it is", async () => {
  stubProvider("steam", [branch("public", "17851234", "2026-09-01T10:00:00.000Z")]);
  const catalog = await resolveVersions(requireGame("project-zomboid"));

  /* The whole point. 17851234 compares above every version string a
     game has ever had, so a build id reaching `serverLatest` would make
     every server permanently, wrongly, out of date. */
  assert.equal(catalog.serverLatest, "42.0.0");
  assert.equal(compareVersions("17851234", "42.0.0"), 1);
  assert.equal(catalog.candidates.every((c) => c.upstream !== "17851234"), true);
});

test("a branch nothing tracks stays listed but unsupported", async () => {
  stubProvider("steam", [
    branch("public", "17851234", "2026-09-01T10:00:00.000Z"),
    branch("experimental", "18000000", "2026-09-09T10:00:00.000Z"),
  ]);

  const catalog = await resolveVersions(requireGame("project-zomboid"));
  const orphan = catalog.candidates.find((c) => c.id === "steam-experimental");

  assert.ok(orphan, "a branch with no version is still worth knowing about");
  assert.equal(orphan.supported, false);
  assert.equal(catalog.supportedLatest?.id, "b41-stable");
});

test("two versions may track one branch and both learn its build id", async () => {
  stubProvider("steam", [branch("public", "9001", "2026-09-04T10:00:00.000Z")]);
  const catalog = await resolveVersions(requireGame("rust"));

  assert.equal(catalog.candidates.find((c) => c.id === "rust-oxide")?.buildId, "9001");
  assert.equal(catalog.candidates.find((c) => c.id === "rust-vanilla")?.buildId, "9001");
});

/* ── The outlook ──────────────────────────────────────────────────── */

test("a moved branch is an update for a game with no version number", async () => {
  stubProvider("steam", [branch("public", "9002", "2026-09-10T10:00:00.000Z")]);
  const catalog = await resolveVersions(requireGame("rust"));

  const outlook = outlookFor(catalog, { versionId: "rust-oxide", buildId: "9001" });
  assert.equal(outlook.buildDrift, true);
  assert.equal(outlook.updateAvailable, true);
  assert.equal(outlook.installedBuildId, "9001");
  assert.equal(outlook.currentBuildId, "9002");
  assert.equal(outlook.branch, "public");
});

test("the same build id is not an update", async () => {
  stubProvider("steam", [branch("public", "9001", "2026-09-04T10:00:00.000Z")]);
  const catalog = await resolveVersions(requireGame("rust"));

  const outlook = outlookFor(catalog, { versionId: "rust-oxide", buildId: "9001" });
  assert.equal(outlook.buildDrift, false);
  assert.equal(outlook.updateAvailable, false);
});

test("a server with no recorded build id is not reported as out of date", async () => {
  stubProvider("steam", [branch("public", "9002", "2026-09-10T10:00:00.000Z")]);
  const catalog = await resolveVersions(requireGame("rust"));

  /* Not knowing is not the same as being behind. A server installed
     before build ids were recorded must not nag forever. */
  const outlook = outlookFor(catalog, { versionId: "rust-oxide", buildId: null });
  assert.equal(outlook.buildDrift, false);
  assert.equal(outlook.updateAvailable, false);
});

/* ── Summarising ──────────────────────────────────────────────────── */

test("the stored catalog and the live one summarise identically", () => {
  const candidates: VersionCandidate[] = [
    {
      id: "old",
      label: "Old",
      upstream: "1.0.0",
      channel: "legacy",
      recommended: false,
      supported: true,
      providerId: "static",
    },
    {
      id: "new",
      label: "New",
      upstream: "2.0.0",
      channel: "stable",
      recommended: true,
      supported: true,
      providerId: "static",
    },
    {
      id: "beta",
      label: "Beta",
      upstream: "3.0.0",
      channel: "preview",
      recommended: false,
      supported: true,
      providerId: "static",
    },
  ];

  const summary = summariseCatalog("test", candidates);
  // Newest first by version, whatever order they arrived in.
  assert.deepEqual(summary.candidates.map((c) => c.id), ["beta", "new", "old"]);
  // Stable beats a numerically newer preview.
  assert.equal(summary.supportedLatest?.id, "new");
  assert.equal(summary.recommended?.id, "new");
  // serverLatest is what exists, including the preview.
  assert.equal(summary.serverLatest, "3.0.0");
});

test("an upstream ahead of anything installable is reported, not hidden", () => {
  const summary = summariseCatalog(
    "test",
    [
      {
        id: "ours",
        label: "Ours",
        upstream: "1.0.0",
        channel: "stable",
        recommended: true,
        supported: true,
        providerId: "static",
      },
    ],
    { gameLatest: "2.0.0" },
  );

  const outlook = outlookFor(summary, "ours");
  assert.equal(outlook.aheadOfSupport, true);
  assert.equal(outlook.updateAvailable, false);
  assert.equal(outlook.gameLatest, "2.0.0");
});
