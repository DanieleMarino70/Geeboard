import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTemplate,
  defaultsFor,
  mergeProperties,
  renderConfig,
  restartRequiredFor,
  validateConfig,
} from "../src/domain/games/config.ts";
import { allGames, findGame, requireGame, requireVersion } from "../src/domain/games/registry.ts";
import { primaryPort, portsFor, strideOf } from "../src/domain/games/types.ts";
import {
  compareVersions,
  outlookFor,
  resolveVersions,
  staticProvider,
} from "../src/domain/games/versions.ts";

/* The game layer, with no database and no Docker. Everything here is a
   pure function of a definition, which is the point of definitions. */

test("every shipped definition passes the registry audit", () => {
  // The audit runs at import; reaching this line means it passed. What
  // is worth asserting is that it actually looked at something.
  assert.ok(allGames().length >= 8);
  assert.ok(findGame("terraria"));
  assert.ok(findGame("project-zomboid"));
  assert.ok(findGame("minecraft-java"));
});

test("an unknown game is a coded refusal, not undefined", () => {
  assert.throws(() => requireGame("halo"), (error: Error & { code?: string }) => {
    assert.equal(error.code, "GAME_NOT_FOUND");
    return true;
  });
});

test("a version that exists but is unsupported is refused differently", () => {
  const game = { ...requireGame("terraria") };
  game.versions = game.versions.map((v) =>
    v.id === "vanilla-1-4-3-6" ? { ...v, supported: false } : v,
  );
  assert.throws(() => requireVersion(game, "vanilla-1-4-3-6"), (error: Error & { code?: string }) => {
    assert.equal(error.code, "GAME_VERSION_UNSUPPORTED");
    return true;
  });
});

/* ── Ports ────────────────────────────────────────────────────────── */

test("a port block covers every role the game declares", () => {
  const minecraft = requireGame("minecraft-java");
  assert.equal(strideOf(minecraft), 3);

  const ports = portsFor(minecraft, 25565);
  assert.deepEqual(
    ports.map((p) => p.host),
    [25565, 25566, 25567],
  );
  // RCON keeps its fixed container port whatever the host port is.
  assert.equal(ports.find((p) => p.id === "rcon")?.container, 25575);
  assert.equal(primaryPort(minecraft, 25565), 25565);
});

test("a private port is marked private and the game port is not", () => {
  const ports = portsFor(requireGame("minecraft-java"), 26000);
  assert.equal(ports.find((p) => p.id === "rcon")?.public, false);
  assert.equal(ports.find((p) => p.id === "game")?.public, true);
});

/* ── Configuration ────────────────────────────────────────────────── */

test("defaults come from the definition and a template overrides them", () => {
  const game = requireGame("minecraft-java");
  assert.equal(defaultsFor(game).mode, "survival");

  const creative = applyTemplate(game, "creative");
  assert.equal(creative.mode, "creative");
  assert.equal(creative.difficulty, "peaceful");
  // Untouched fields keep their default rather than disappearing.
  assert.equal(creative.maxPlayers, 40);
});

test("an unknown template leaves the defaults alone rather than throwing", () => {
  const game = requireGame("minecraft-java");
  assert.deepEqual(applyTemplate(game, "no-such-template"), defaultsFor(game));
});

test("validation reports every bad field, not just the first", () => {
  const game = requireGame("minecraft-java");
  const problems = validateConfig(game, {
    maxPlayers: 0,
    viewDistance: 99,
    difficulty: "impossible",
  });
  assert.equal(problems.length, 3);
  assert.deepEqual(problems.map((p) => p.key).sort(), ["difficulty", "maxPlayers", "viewDistance"]);
});

test("a setting the game does not have is a problem in itself", () => {
  const problems = validateConfig(requireGame("terraria"), { javaHeap: 4 });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /no setting called javaHeap/);
});

test("a newline is refused in a single-line field and allowed in a text one", () => {
  const zomboid = requireGame("project-zomboid");
  assert.equal(validateConfig(zomboid, { serverName: "a\nb" }).length, 1);
  assert.equal(validateConfig(zomboid, { description: "line one\nline two" }).length, 0);
});

test("environment targets render, and the version's own variables win over the install's", () => {
  const game = requireGame("minecraft-java");
  const rendered = renderConfig(game, applyTemplate(game, "hardcore"), {
    env: { TYPE: "PAPER", VERSION: "1.21.4" },
  });

  // The image's licence acceptance is not a setting, and still gets set.
  assert.equal(rendered.env.EULA, "TRUE");
  assert.equal(rendered.env.TYPE, "PAPER");
  assert.equal(rendered.env.HARDCORE, "true");
  assert.equal(rendered.env.ENABLE_WHITELIST, "true");
  assert.equal(rendered.files.length, 0);
});

test("a file-configured game renders patches rather than variables", () => {
  const terraria = requireGame("terraria");
  const rendered = renderConfig(terraria, applyTemplate(terraria, "journey"));

  assert.equal(rendered.files.length, 1);
  const patch = rendered.files[0]!;
  assert.equal(patch.path, "serverconfig.txt");
  assert.equal(patch.format, "properties");
  assert.equal(patch.entries.find((e) => e.key === "difficulty")?.value, "3");
  assert.equal(patch.entries.find((e) => e.key === "maxplayers")?.value, "8");
});

test("an INI target keeps its section", () => {
  const palworld = requireGame("palworld");
  const rendered = renderConfig(palworld, applyTemplate(palworld, "coop"));
  const patch = rendered.files.find((f) => f.format === "ini");
  assert.ok(patch);
  assert.equal(patch.entries.find((e) => e.key === "CaptureRate")?.section, "/Script/Pal.PalGameWorldSettings");
});

test("merging a properties file changes only the keys asked for", () => {
  const before = ["# a comment", "maxplayers=8", "", "motd=old", "worldname=keepme"].join("\n");
  const after = mergeProperties(before, [
    { key: "maxplayers", value: "16" },
    { key: "secure", value: "1" },
  ]);

  assert.match(after, /^# a comment$/m);
  assert.match(after, /^maxplayers=16$/m);
  assert.match(after, /^motd=old$/m);
  assert.match(after, /^worldname=keepme$/m);
  // A key the file did not have is appended rather than dropped.
  assert.match(after, /^secure=1$/m);
});

test("only the fields that need a restart are reported as needing one", () => {
  const game = requireGame("minecraft-java");
  const before = defaultsFor(game);
  const labels = restartRequiredFor(game, before, { ...before, pvp: false, viewDistance: 6 });
  assert.deepEqual(labels, ["View distance"]);
});

/* ── Versions ─────────────────────────────────────────────────────── */

test("version comparison is numeric, not lexical", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.4.4.9", "1.4.4.10"), -1);
  assert.equal(compareVersions("1.21.4", "1.21.4"), 0);
  // A missing segment is older, not equal.
  assert.equal(compareVersions("1.21", "1.21.4"), -1);
});

test("resolution prefers a stable channel over a numerically newer preview", async () => {
  const catalog = await resolveVersions(requireGame("project-zomboid"));
  assert.equal(catalog.supportedLatest?.id, "b41-stable");
  assert.equal(catalog.recommended?.id, "b41-stable");
  // The preview is still listed — it is offered, just not recommended.
  assert.ok(catalog.candidates.some((c) => c.id === "b42-unstable"));
});

test("a provider that fails is reported and does not empty the list", async () => {
  const game = {
    ...requireGame("terraria"),
    versionSources: [{ provider: "static" as const }, { provider: "steam" as const, appId: 1 }],
  };
  const { registerVersionProvider } = await import("../src/domain/games/versions.ts");
  registerVersionProvider("steam", () => ({
    id: "steam",
    async list() {
      throw new Error("upstream is down");
    },
  }));

  const catalog = await resolveVersions(game);
  assert.ok(catalog.candidates.length >= 3);
  assert.equal(catalog.providerErrors.length, 1);
  assert.equal(catalog.providerErrors[0]!.provider, "steam");
});

test("a source naming an unregistered provider is skipped, not an error", async () => {
  const game = {
    ...requireGame("terraria"),
    versionSources: [
      { provider: "static" as const },
      { provider: "github" as const, owner: "nobody", repo: "nothing" },
    ],
  };
  const catalog = await resolveVersions(game);
  assert.deepEqual(catalog.providerErrors, []);
  assert.ok(catalog.candidates.length >= 3);
});

test("the static provider never invents a version", async () => {
  const game = requireGame("valheim");
  const listed = await staticProvider.list(game);
  assert.equal(listed.length, game.versions.length);
});

test("the outlook separates what the game is on from what we can install", async () => {
  const game = requireGame("terraria");
  const catalog = await resolveVersions(game);

  // A newer game than anything installable: the panel should say so
  // rather than showing an update it cannot actually perform.
  const ahead = { ...catalog, gameLatest: "1.4.5.8" };
  const outlook = outlookFor(ahead, "vanilla-1-4-4-9");
  assert.equal(outlook.aheadOfSupport, true);
  assert.equal(outlook.updateAvailable, false);
  assert.equal(outlook.installed, "1.4.4.9");
});

test("an older installed version is an update, and the newest one is not", async () => {
  const catalog = await resolveVersions(requireGame("terraria"));
  assert.equal(outlookFor(catalog, "vanilla-1-4-3-6").updateAvailable, true);
  assert.equal(outlookFor(catalog, "vanilla-1-4-4-9").updateAvailable, false);
});
