import assert from "node:assert/strict";
import { test } from "node:test";
import { currentConfig, renderConfig } from "../src/domain/games/config.ts";
import { requireGame, versionOfServer } from "../src/domain/games/registry.ts";
import {
  outlookFor,
  resolveVersions,
  summariseCatalog,
  type VersionCandidate,
} from "../src/domain/games/versions.ts";

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

/* ── Lines ────────────────────────────────────────────────────────── */

test("an update never crosses a line, however much newer the other side is", async () => {
  const catalog = await resolveVersions(requireGame("project-zomboid"));

  /* Build 42 is newer by every measure and a build 41 world does not
     open in it. Offering it as an update would be offering to break the
     world, with a locked backup as the consolation. */
  const outlook = outlookFor(catalog, "b41");
  assert.equal(outlook.updateAvailable, false);
  assert.equal(outlook.updateTo, null);
  // Said, rather than hidden: the operator can read the patch notes.
  assert.equal(outlook.newerLine?.id, "b42");

  // And from the other side, build 42 is simply current.
  assert.equal(outlookFor(catalog, "b42").updateAvailable, false);
  assert.equal(outlookFor(catalog, "b42").newerLine, null);
});

test("a server is offered its own software, not whichever sorts first", async () => {
  const minecraft = await resolveVersions(requireGame("minecraft-java"));
  /* Paper, Purpur, Fabric and vanilla are all newer than Paper 1.20.6.
     Only Paper keeps the server's plugins — and of Paper's, the newest
     stable one, not the 26.3 whose builds Paper still calls alpha. */
  assert.equal(outlookFor(minecraft, "paper-1-20-6").updateTo?.id, "paper-26-2");
  assert.equal(outlookFor(minecraft, "paper-1-21-4").updateTo?.id, "paper-26-2");
  assert.equal(outlookFor(minecraft, "paper-26-2").updateTo, null, "a stable server is not moved onto a preview");

  /* The old offer was "the recommended version, if you are not on it",
     which proposed Paper to a Fabric 1.21.4 server as an update. It is
     told a newer Minecraft exists on another line, and offered nothing. */
  const fabric = outlookFor(minecraft, "fabric-1-21-4");
  assert.equal(fabric.updateAvailable, false);
  assert.equal(fabric.updateTo, null);
  assert.equal(fabric.newerLine?.id, "paper-26-2");

  const terraria = await resolveVersions(requireGame("terraria"));
  // TShock was released later than vanilla 1.4.4.9 and would have won.
  assert.equal(outlookFor(terraria, "vanilla-1-4-3-6").updateTo?.id, "vanilla-1-4-5-8");
  assert.equal(outlookFor(terraria, "vanilla-1-4-4-9").updateTo?.id, "vanilla-1-4-5-8");
});

test("two versions with no version number are not ordered", () => {
  const catalog = summariseCatalog("test", [
    candidate({ id: "a", label: "A", recommended: true }),
    candidate({ id: "b", label: "B", released: "2030-01-01" }),
  ]);

  /* "Cannot tell" is not "newer". Without a version string there is
     nothing to call an update — the build id is what answers that. */
  assert.equal(outlookFor(catalog, "b").updateAvailable, false);
  assert.equal(outlookFor(catalog, "a").updateAvailable, false);
});

test("a preview in its own line is not moved onto the release", async () => {
  const catalog = await resolveVersions(requireGame("minecraft-bedrock"));
  assert.equal(outlookFor(catalog, "bedrock-preview").updateAvailable, false);
});

/* ── Which version a server is on ─────────────────────────────────── */

test("a server's version comes from its link before its label", () => {
  const game = requireGame("project-zomboid");

  // Created as "Build 41 · stable", linked to the row since renamed.
  const renamed = versionOfServer(game, { versionSlug: "b41-stable", versionLabel: "Build 41 · stable" });
  assert.equal(renamed?.id, "b41");

  // The link wins over a label that says something else.
  const linked = versionOfServer(game, { versionSlug: "b41", versionLabel: "Build 42" });
  assert.equal(linked?.id, "b41");

  // A server with no link falls back to its label.
  assert.equal(versionOfServer(game, { versionLabel: "Build 42" })?.id, "b42");
});

test("a server whose version resolves to nothing gets nothing, not a guess", () => {
  /* This used to be the definition's first version. A rebuild on that
     guess would have put a build 41 world on build 42. */
  const game = requireGame("project-zomboid");
  assert.equal(versionOfServer(game, { versionSlug: null, versionLabel: "Build 40" }), undefined);
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
