import assert from "node:assert/strict";
import { test } from "node:test";
import { currentConfig, renderConfig } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { outlookFor, summariseCatalog, type VersionCandidate } from "../src/domain/games/versions.ts";

/* Updating, as far as it can be tested without a node.

   The sequence itself needs a runtime and a database — it is exercised
   by the verify scripts. What is testable here is the arithmetic that
   decides whether an update is offered at all, and what a rebuilt
   workload would be given, which is where a wrong answer is silent. */

function candidate(overrides: Partial<VersionCandidate> & { id: string }): VersionCandidate {
  return {
    label: overrides.id,
    channel: "stable",
    recommended: false,
    supported: true,
    providerId: "static",
    ...overrides,
  };
}

test("an update is only offered when a newer supported version exists", () => {
  const catalog = summariseCatalog("test", [
    candidate({ id: "old", label: "Old", upstream: "1.0.0" }),
    candidate({ id: "new", label: "New", upstream: "2.0.0", recommended: true }),
  ]);

  assert.equal(outlookFor(catalog, "old").updateAvailable, true);
  assert.equal(outlookFor(catalog, "new").updateAvailable, false);
});

test("a version Geeboard will not install is never the target", () => {
  const catalog = summariseCatalog("test", [
    candidate({ id: "ours", label: "Ours", upstream: "1.0.0", recommended: true }),
    // Newer, and listed only so the panel can say it exists.
    candidate({ id: "theirs", label: "Theirs", upstream: "3.0.0", supported: false }),
  ]);

  assert.equal(catalog.recommended?.id, "ours");
  assert.equal(outlookFor(catalog, "ours").updateAvailable, false);
  // And the panel still says the game has moved on, rather than
  // claiming the server is current with upstream.
  assert.equal(outlookFor(catalog, "ours").aheadOfSupport, true);
});

test("a preview build is not what an operator is offered", () => {
  const catalog = summariseCatalog("test", [
    candidate({ id: "stable", label: "Stable", upstream: "1.0.0", recommended: true }),
    candidate({ id: "beta", label: "Beta", upstream: "2.0.0", channel: "preview" }),
  ]);

  /* Numerically ahead and still not the recommendation. Updating a
     production server onto a beta because it sorts higher is the kind
     of helpfulness nobody asked for. */
  assert.equal(catalog.recommended?.id, "stable");
  assert.equal(outlookFor(catalog, "stable").updateAvailable, false);
});

test("a Steam game with no version number updates on its build id", () => {
  const catalog = summariseCatalog("test", [
    candidate({
      id: "public",
      label: "Rust · Oxide",
      branch: "public",
      buildId: "9002",
      recommended: true,
    }),
  ]);

  const outlook = outlookFor(catalog, { versionId: "public", buildId: "9001" });
  assert.equal(outlook.updateAvailable, true);
  assert.equal(outlook.buildDrift, true);
  // There is no version string to move between; the label is unchanged.
  assert.equal(outlook.installed, null);
});

/* ── What a rebuilt workload is given ─────────────────────────────── */

test("a rebuild renders the new version's environment, not the old one's", () => {
  const game = requireGame("minecraft-java");
  const server = { config: { maxPlayers: 30, difficulty: "hard" } };

  const before = renderConfig(game, currentConfig(game, server), {
    env: { TYPE: "PAPER", VERSION: "1.20.6" },
  });
  const after = renderConfig(game, currentConfig(game, server), {
    env: { TYPE: "PAPER", VERSION: "1.21.4" },
  });

  assert.equal(before.env.VERSION, "1.20.6");
  assert.equal(after.env.VERSION, "1.21.4");
  // And the operator's settings survive the version change, which is
  // the whole reason config is stored rather than baked in at creation.
  assert.equal(after.env.MAX_PLAYERS, "30");
  assert.equal(after.env.DIFFICULTY, "hard");
});

test("an update keeps settings the server was configured with", () => {
  const game = requireGame("terraria");
  const server = { config: { maxPlayers: 24, difficulty: "1", motd: "ours" } };

  const rendered = renderConfig(game, currentConfig(game, server), undefined, {
    includeEmpty: true,
  });
  const patch = rendered.files.find((f) => f.path === "serverconfig.txt")!;

  assert.equal(patch.entries.find((e) => e.key === "maxplayers")?.value, "24");
  assert.equal(patch.entries.find((e) => e.key === "difficulty")?.value, "1");
  assert.equal(patch.entries.find((e) => e.key === "motd")?.value, "ours");
});

test("a server with no stored settings falls back to the game's defaults", () => {
  const game = requireGame("minecraft-java");
  const rendered = renderConfig(game, currentConfig(game, { config: null }));

  // Not an empty environment — a rebuild that dropped every setting
  // would look like an update that reset the server.
  assert.equal(rendered.env.MAX_PLAYERS, "40");
  assert.equal(rendered.env.EULA, "TRUE");
});
