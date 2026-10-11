import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTemplate,
  defaultsFor,
  heldByWorkload,
  mergeProperties,
  planConfigChange,
  readConfigValues,
  renderConfig,
  restartRequiredFor,
  validateConfig,
} from "../src/domain/games/config.ts";
/* Two parked definitions, imported past the registry: Rust is the one
   with a `text` field and Palworld the one with an INI target, and the
   tests below are about those mechanisms, not about the games. */
import { PALWORLD } from "../src/domain/games/definitions/palworld.ts";
import { RUST } from "../src/domain/games/definitions/rust.ts";
import {
  allGames,
  findGame,
  findVersion,
  requireGame,
  requireVersion,
} from "../src/domain/games/registry.ts";
import { primaryPort, portsFor, provisionPorts, strideOf } from "../src/domain/games/types.ts";
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
  assert.ok(allGames().length >= 5);
  assert.ok(findGame("terraria"));
  assert.ok(findGame("project-zomboid"));
  assert.ok(findGame("minecraft-java"));
});

test("a parked game is not offered, and asking for it is the ordinary refusal", () => {
  /* Rust, Palworld and Satisfactory keep their definitions and leave the
     registry until they have run on a machine with the memory. Nothing
     that reads the registry may see them — the wizard, the Games page
     and the API all list from here. */
  for (const id of ["rust", "palworld", "satisfactory"]) {
    assert.equal(findGame(id), undefined, id);
    assert.throws(() => requireGame(id), (error: Error & { code?: string }) => error.code === "GAME_NOT_FOUND");
  }
  // The parked definitions still hold together on their own.
  assert.equal(RUST.id, "rust");
  assert.equal(PALWORLD.id, "palworld");
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

/* What reaches the node. A private port was published on every
   interface, which put a Minecraft server's RCON on the internet. */
test("a private port is created on loopback, for every game", () => {
  for (const game of allGames()) {
    const provisioned = provisionPorts(game, game.portBase);
    const declared = portsFor(game, game.portBase);
    for (const [i, port] of provisioned.entries()) {
      assert.equal(port.loopback, !declared[i]!.public, `${game.id} ${port.label}`);
    }
  }
  const minecraft = provisionPorts(requireGame("minecraft-java"), 25565);
  assert.deepEqual(
    minecraft.map((p) => [p.label, p.loopback]),
    [["Game", false], ["Query", false], ["RCON", true]],
  );
});

/* The server inside the image listens where the image puts it, whatever
   host port the node allocated. Without a fixed container port, a second
   server on a node publishes a port nothing inside is listening on. */
test("a Minecraft server listens on 25565 inside, whichever block it was given", () => {
  const ports = portsFor(requireGame("minecraft-java"), 25965);
  assert.equal(ports.find((p) => p.id === "game")?.host, 25965);
  assert.equal(ports.find((p) => p.id === "game")?.container, 25565);
  assert.equal(ports.find((p) => p.id === "query")?.container, 25565);
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
  // Rust's description is an environment variable, where a newline is harmless.
  assert.equal(validateConfig(RUST, { serverName: "a\nb" }).length, 1);
  assert.equal(validateConfig(RUST, { description: "line one\nline two" }).length, 0);
  /* Zomboid's is a line in a properties file, where a newline would end
     the value and start a key nobody wrote. The game spells a line break
     <LINE>. */
  assert.equal(validateConfig(requireGame("project-zomboid"), { description: "one\ntwo" }).length, 1);
});

test("environment targets render beside the install's and the version's variables", () => {
  const rendered = renderConfig(RUST, applyTemplate(RUST, RUST.templates[0]!.id));
  const field = RUST.config.find((f) => f.target.kind === "env")!;
  assert.equal(field.target.kind === "env" && field.target.name in rendered.env, true);
  assert.equal(rendered.files.length, 0);
});

/* Minecraft's settings are lines of server.properties (0.11.0): the image
   writes a variable it is given over the file on every start, so nothing
   the operator sets may be one. What is left in the environment is what
   the image needs to run at all. */
test("Minecraft Java's settings render into server.properties, and only what the image needs is a variable", () => {
  const game = requireGame("minecraft-java");
  const rendered = renderConfig(game, applyTemplate(game, "hardcore"), {
    env: { TYPE: "PAPER", VERSION: "1.21.4" },
  });

  assert.deepEqual(Object.keys(rendered.env).sort(), ["ENABLE_QUERY", "EULA", "JVM_XX_OPTS", "MEMORY", "TYPE", "VERSION"]);
  assert.equal(rendered.files.length, 1);
  const patch = rendered.files[0]!;
  assert.equal(patch.path, "server.properties");
  const line = (key: string) => patch.entries.find((e) => e.key === key)?.value;
  assert.equal(line("hardcore"), "true");
  assert.equal(line("white-list"), "true");
  assert.equal(line("max-players"), "40");
  assert.equal(line("allow-flight"), "false");
  // The template's empty seed is "not set", and a new world picks its own.
  assert.equal(line("level-seed"), undefined);
});

test("Minecraft Bedrock's settings render into server.properties too", () => {
  const game = requireGame("minecraft-bedrock");
  const rendered = renderConfig(game, applyTemplate(game, "survival"), game.versions[0], { creating: true });
  assert.deepEqual(Object.keys(rendered.env).sort(), ["EULA", "VERSION"]);
  const patch = rendered.files.find((f) => f.path === "server.properties")!;
  const line = (key: string) => patch.entries.find((e) => e.key === key)?.value;
  assert.equal(line("server-name"), "Geeboard");
  assert.equal(line("allow-list"), "true");
  assert.equal(line("default-player-permission-level"), "member");
  assert.equal(line("texturepack-required"), "false");
  assert.equal(line("level-name"), "Bedrock level");
  /* The archive's own lines, which it does not unpack over the panel's
     file: without transport=nethernet a 1.26.51.1 server said players
     would not be able to connect. Only for a server being made. */
  assert.equal(line("transport"), "nethernet");
  const later = renderConfig(game, applyTemplate(game, "survival"), game.versions[0], { includeEmpty: true });
  assert.equal(later.files[0]!.entries.some((e) => e.key === "transport" || e.key === "tick-distance"), false);
});

/* Keys as the servers wrote them, October 2026: Paper 26.2's own
   server.properties for Java, the image's property map for Bedrock. */
test("each Minecraft setting names the key its server reads", () => {
  const keys = (gameId: string) =>
    Object.fromEntries(requireGame(gameId).config.map((f) => [f.key, f.target.kind === "properties" ? f.target.key : `not a line: ${f.target.kind}`]));
  assert.deepEqual(keys("minecraft-java"), {
    motd: "motd",
    mode: "gamemode",
    difficulty: "difficulty",
    hardcore: "hardcore",
    seed: "level-seed",
    levelType: "level-type",
    commandBlocks: "enable-command-block",
    maxPlayers: "max-players",
    pvp: "pvp",
    allowFlight: "allow-flight",
    whitelist: "white-list",
    onlineMode: "online-mode",
    resourcePack: "resource-pack",
    resourcePackRequired: "require-resource-pack",
    resourcePackPrompt: "resource-pack-prompt",
    resourcePackSha1: "resource-pack-sha1",
    viewDistance: "view-distance",
    simulationDistance: "simulation-distance",
    maxTickTime: "max-tick-time",
    spawnProtection: "spawn-protection",
  });
  assert.deepEqual(keys("minecraft-bedrock"), {
    serverName: "server-name",
    mode: "gamemode",
    difficulty: "difficulty",
    allowCheats: "allow-cheats",
    levelName: "level-name",
    levelSeed: "level-seed",
    maxPlayers: "max-players",
    allowList: "allow-list",
    defaultPermission: "default-player-permission-level",
    texturePackRequired: "texturepack-required",
    onlineMode: "online-mode",
    viewDistance: "view-distance",
  });
  // Every one of them is saved now and read at the next start.
  for (const gameId of ["minecraft-java", "minecraft-bedrock"]) {
    for (const field of requireGame(gameId).config) {
      assert.ok(field.restartRequired || field.fixedAfterCreation, `${gameId} ${field.key}`);
    }
  }
});

/* The server rewrites its file as java.util.Properties does, with a
   backslash before `:`, `=`, `#` and `!`: measured on Paper 26.2, which
   turned `motd=Hello: world! #1` into `motd=Hello\: world\! \#1`. */
test("a Java server's escapes are taken off when its file is read, and a backslash is written as the reader wants it", () => {
  const game = requireGame("minecraft-java");
  const file = [
    "#Minecraft server properties",
    "motd=Hello\\: world\\! \\#1 caf\u00e9",
    "level-type=minecraft\\:flat",
    'resource-pack-prompt="Please accept\\: it is ours\\!"',
    "resource-pack=https\\://example.com/pack.zip",
  ].join("\n");
  const values = readConfigValues(game, [{ path: "server.properties", content: file }]);
  assert.equal(values.motd, "Hello: world! #1 caf\u00e9");
  assert.equal(values.levelType, "minecraft:flat");
  assert.equal(values.resourcePackPrompt, "Please accept: it is ours!");
  assert.equal(values.resourcePack, "https://example.com/pack.zip");

  const rendered = renderConfig(game, { ...defaultsFor(game), motd: "C:\\games is ours", resourcePackPrompt: 'Say "yes"' });
  const line = (key: string) => rendered.files[0]!.entries.find((e) => e.key === key)?.value;
  assert.equal(line("motd"), "C:\\\\games is ours");
  // JSON text, because the game refused plain words ("Failed to parse resource pack prompt" on 26.2).
  assert.equal(line("resource-pack-prompt"), '"Say \\\\"yes\\\\""');
  // What is written reads back as what was typed.
  const back = readConfigValues(game, [{ path: "server.properties", content: mergeProperties("", rendered.files[0]!.entries) }]);
  assert.equal(back.motd, "C:\\games is ours");
  assert.equal(back.resourcePackPrompt, 'Say "yes"');
});

/* A server made before 0.11.0 has its settings as variables in its
   workload, and the image puts them back over the file on every start. */
test("a setting an older workload still holds as a variable rebuilds it once", () => {
  const game = requireGame("minecraft-java");
  const before = defaultsFor(game);
  const after = { ...before, motd: "new", allowFlight: true };

  const old = heldByWorkload(game, { env: { EULA: "TRUE", MOTD: "A Geeboard server", MAX_PLAYERS: "40" } });
  assert.deepEqual([...old].sort(), ["maxPlayers", "motd"]);
  const plan = planConfigChange(game, before, after, old);
  assert.equal(plan.changes.find((c) => c.key === "motd")?.applies, "on-recreate");
  // A setting that was never a variable is the file's already.
  assert.equal(plan.changes.find((c) => c.key === "allowFlight")?.applies, "on-restart");

  // Once rebuilt, nothing is held and a change waits for a restart.
  const rebuilt = heldByWorkload(game, { env: { EULA: "TRUE", TYPE: "PAPER" } });
  assert.equal(rebuilt.size, 0);
  assert.equal(planConfigChange(game, before, after, rebuilt).needsRecreate, false);
  // A workload with no record of what it was made from is older than the record.
  assert.ok(heldByWorkload(game, null).has("motd"));
});

/* A setting the game gained after a server was made — Minecraft's
   allow-flight, in 0.11.0 — may already be in its file, set by hand in
   Files. A rebuild or a save writes what the server was given, not a
   default over that line. */
test("a file's line the server was never given a value for is left as it is", () => {
  const game = requireGame("minecraft-java");
  const stored = { motd: "Ours", maxPlayers: 12 };
  const rendered = renderConfig(game, { ...defaultsFor(game), ...stored }, undefined, { includeEmpty: true, stored });
  const keys = rendered.files[0]!.entries.map((e) => e.key);
  assert.deepEqual(keys.sort(), ["max-players", "motd"]);
  // Without the stored settings, as at creation, every setting is written.
  assert.ok(renderConfig(game, defaultsFor(game)).files[0]!.entries.some((e) => e.key === "allow-flight"));
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
  const rendered = renderConfig(PALWORLD, applyTemplate(PALWORLD, "coop"));
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
  const unread = { ...game, config: game.config.map((f) => (f.key === "pvp" ? { ...f, restartRequired: false } : f)) };
  const labels = restartRequiredFor(unread, before, { ...before, pvp: false, viewDistance: 6, motd: before.motd! });
  assert.deepEqual(labels, ["View distance"]);
});

/* What each setting is for, and when it applies — from the UI/UX audit of
   October 2026, checked against the games' own images. */

const fieldOf = (gameId: string, key: string) => {
  const field = requireGame(gameId).config.find((f) => f.key === key);
  assert.ok(field, `${gameId} has a setting called ${key}`);
  return field;
};

test("Minecraft Java's world seed is chosen at creation and written only then", () => {
  assert.equal(fieldOf("minecraft-java", "seed").fixedAfterCreation, true);
  const game = requireGame("minecraft-java");
  const values = { ...applyTemplate(game, "survival"), seed: "12345" };
  // The wizard's render has it; a settings save, rebuild or update does not.
  const seedLine = (options: Parameters<typeof renderConfig>[3]) =>
    renderConfig(game, values, undefined, options).files[0]!.entries.find((e) => e.key === "level-seed")?.value;
  assert.equal(seedLine({ creating: true }), "12345");
  assert.equal(seedLine({ includeEmpty: true }), undefined);
  // The same for the world's type, and for Bedrock's seed and world name.
  assert.equal(fieldOf("minecraft-java", "levelType").fixedAfterCreation, true);
  assert.equal(fieldOf("minecraft-bedrock", "levelSeed").fixedAfterCreation, true);
  assert.equal(fieldOf("minecraft-bedrock", "levelName").fixedAfterCreation, true);
});

test("settings that apply after creation are not fixed, however they read", () => {
  /* Terraria's are used for the next world generated, which World file can
     ask for at any time; Valheim's modifier is applied on every start. */
  for (const key of ["difficulty", "worldSize", "seed"]) {
    assert.notEqual(fieldOf("terraria", key).fixedAfterCreation, true, `terraria ${key}`);
    assert.match(fieldOf("terraria", key).help ?? "", /when a world is generated/, `terraria ${key}`);
  }
  assert.notEqual(fieldOf("valheim", "preset").fixedAfterCreation, true);
  assert.match(fieldOf("valheim", "preset").help ?? "", /every start/);
  assert.doesNotMatch(fieldOf("valheim", "preset").help ?? "", /keeps the modifier/);
});

test("game mode, difficulty and the join lists say what they do", () => {
  for (const gameId of ["minecraft-java", "minecraft-bedrock"]) {
    assert.match(fieldOf(gameId, "mode").help ?? "", /first time they join/, gameId);
    assert.match(fieldOf(gameId, "difficulty").help ?? "", /^Peaceful: no monsters/, gameId);
  }
  // The commands as the servers took them: 26.2 and 1.26.51.1, October 2026.
  assert.match(fieldOf("minecraft-java", "whitelist").help ?? "", /whitelist add <name>/);
  assert.match(fieldOf("minecraft-bedrock", "allowList").help ?? "", /allowlist add <name>/);
  assert.doesNotMatch(fieldOf("minecraft-bedrock", "allowList").help ?? "", /open door/);
  assert.match(fieldOf("terraria", "secure").help ?? "", /cheat/);
});

test("Minecraft Java has no keep-inventory setting, because the image never read one", () => {
  const game = requireGame("minecraft-java");
  assert.equal(game.config.some((f) => f.key === "keepInventory"), false);
  // A server that stored one from an older panel still renders, without it.
  const rendered = renderConfig(game, { ...defaultsFor(game), keepInventory: true }, undefined, { includeEmpty: true });
  assert.equal("KEEP_INVENTORY" in rendered.env, false);
  assert.equal(rendered.files[0]!.entries.some((e) => /keep/i.test(e.key)), false);
});

/* Moved into the world as game rules by 1.21.9: a 26.2 world started with
   pvp=false in its file answered that the pvp rule was true. The settings
   stay for the 1.21 and 1.20 versions and say what to type on 26. */
test("PvP and command blocks say how to set them from 26.1 on", () => {
  assert.match(fieldOf("minecraft-java", "pvp").help ?? "", /gamerule pvp false/);
  assert.match(fieldOf("minecraft-java", "commandBlocks").help ?? "", /gamerule command_blocks_work true/);
});

/* ── Versions ─────────────────────────────────────────────────────── */

test("version comparison is numeric, not lexical", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.4.4.9", "1.4.4.10"), -1);
  assert.equal(compareVersions("1.21.4", "1.21.4"), 0);
  // A missing segment is older, not equal.
  assert.equal(compareVersions("1.21", "1.21.4"), -1);
});

test("Zomboid recommends build 42 and still installs build 41", async () => {
  const catalog = await resolveVersions(requireGame("project-zomboid"));
  assert.equal(catalog.recommended?.id, "b42");
  assert.equal(catalog.supportedLatest?.id, "b42");
  assert.equal(catalog.candidates.find((c) => c.id === "b41")?.supported, true);
  /* The unstable branch is gone. Its version stays listed so the servers
     made on it still resolve to something, and is refused for anything
     new. */
  assert.equal(catalog.candidates.find((c) => c.id === "b42-unstable")?.supported, false);
});

test("a renamed version is still found by the id it used to have", () => {
  const game = requireGame("project-zomboid");
  // Stored on servers, in rollback records, in somebody's API script.
  assert.equal(findVersion(game, "b41-stable")?.id, "b41");
  assert.equal(findVersion(game, "b41")?.id, "b41");
  assert.equal(findVersion(game, "b40"), undefined);
});

test("a version Geeboard no longer installs is refused, not silently swapped", () => {
  const game = requireGame("project-zomboid");
  assert.throws(
    () => requireVersion(game, "b42-unstable"),
    (error: Error & { code?: string }) => error.code === "GAME_VERSION_UNSUPPORTED",
  );
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
  const ahead = { ...catalog, gameLatest: "1.4.6.0" };
  const outlook = outlookFor(ahead, "vanilla-1-4-5-8");
  assert.equal(outlook.aheadOfSupport, true);
  assert.equal(outlook.updateAvailable, false);
  assert.equal(outlook.installed, "1.4.5.8");
});

test("an older installed version is an update, and the newest one is not", async () => {
  const catalog = await resolveVersions(requireGame("terraria"));
  assert.equal(outlookFor(catalog, "vanilla-1-4-3-6").updateAvailable, true);
  assert.equal(outlookFor(catalog, "vanilla-1-4-4-9").updateAvailable, true);
  assert.equal(outlookFor(catalog, "vanilla-1-4-5-8").updateAvailable, false);
});

/* Terraria as first shipped wrote serverconfig.txt where the image never
   looked, named no world, and so booted into an interactive menu — or,
   with WORLD_FILENAME set, exited before reading its config at all. */
test("Terraria's config tells the image where the world is, beneath the settings", () => {
  const terraria = requireGame("terraria");
  const rendered = renderConfig(terraria, applyTemplate(terraria, "classic"), requireVersion(terraria, "vanilla-1-4-5-8"));

  assert.equal(rendered.env.CONFIGPATH, "/data", "the image reads serverconfig.txt from the server's directory");
  assert.equal(rendered.env.WORLD_FILENAME, undefined, "set, the bootstrap exits on a new server");

  const patch = rendered.files.find((f) => f.path === "serverconfig.txt")!;
  const entry = (key: string) => patch.entries.filter((e) => e.key === key).at(-1)?.value;
  assert.equal(entry("world"), "/data/geeboard.wld");
  assert.equal(entry("autocreate"), "2", "and it is made on first boot, at the template's size");
  assert.equal(entry("maxplayers"), "16");
});

test("a setting with the same key as a fixed entry is the one written", () => {
  const terraria = requireGame("terraria");
  const game = {
    ...terraria,
    install: {
      kind: "image" as const,
      files: [{ file: "serverconfig.txt", kind: "properties" as const, entries: { maxplayers: "1" } }],
    },
  };
  const written = mergeProperties("", renderConfig(game, { maxPlayers: 12 }).files[0]!.entries);
  assert.match(written, /^maxplayers=12$/m);
  assert.doesNotMatch(written, /^maxplayers=1$/m);
});

/* Start arguments. They were rendered and then dropped — nothing carried
   them to a node — so TShock, which reads Terraria's config only when
   told where it is, could not be installed. */
test("TShock starts pointed at the config Geeboard writes; vanilla starts with nothing extra", () => {
  const terraria = requireGame("terraria");
  const values = applyTemplate(terraria, "classic");
  assert.deepEqual(renderConfig(terraria, values, requireVersion(terraria, "tshock-1-4-4-9")).args, [
    "-config",
    "/data/serverconfig.txt",
  ]);
  assert.deepEqual(renderConfig(terraria, values, requireVersion(terraria, "vanilla-1-4-5-8")).args, []);
});

test("a setting targeting a flag comes after the version's own arguments", () => {
  const terraria = requireGame("terraria");
  const game = {
    ...terraria,
    config: [
      ...terraria.config,
      { key: "lang", label: "Language", type: "string" as const, default: "en-US", target: { kind: "arg" as const, flag: "-lang" } },
    ],
  };
  const rendered = renderConfig(game, { lang: "it-IT" }, { args: ["-config", "/data/serverconfig.txt"] });
  assert.deepEqual(rendered.args, ["-config", "/data/serverconfig.txt", "-lang", "it-IT"]);
});

test("every Terraria image is a pinned, published tag", () => {
  for (const version of requireGame("terraria").versions) {
    assert.doesNotMatch(version.image, /:latest$/, `${version.id} is pinned`);
    assert.match(version.image, /^ryshe\/terraria:(vanilla|tshock)-\d/, `${version.id} names a real tag family`);
  }
});
