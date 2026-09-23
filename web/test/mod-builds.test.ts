import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSummary,
  chosenFolder,
  gameVersionOf,
  judgeMod,
  judgeServer,
  otherBuildOnly,
  refusalText,
  requiredIds,
  type ModFacts,
  type ModInfoFacts,
} from "../src/domain/games/mod-builds.ts";
import { requireGame } from "../src/domain/games/registry.ts";

/* Which mods a build loads, as arithmetic. Every case here is one the
   game itself was shown, on 42.20.4 and 41.78.19, with a test mod whose
   Lua printed which folder it was read from — the comments say what the
   game did. The real downloads (Rawt Building Craft) are in
   daemon/test/mods.test.ts; verify-mods.mts runs the game. */

const zomboid = requireGame("project-zomboid");
const layout = zomboid.mods!.layout;
const tags = zomboid.mods!.buildTags!;
const b42 = gameVersionOf("42.20.4")!;
const b41 = gameVersionOf("41.78.19")!;

function info(folder: string, id: string, bounds: Partial<Pick<ModInfoFacts, "versionMin" | "versionMax">> = {}): ModInfoFacts {
  return { folder, id, name: id, versionMin: bounds.versionMin ?? null, versionMax: bounds.versionMax ?? null };
}

function mod(dir: string, folders: string[], infos: ModInfoFacts[]): ModFacts {
  return { dir, folders, infos };
}

test("Project Zomboid says where each build looks, and which tags name a build", () => {
  assert.deepEqual(layout, { versionFoldersFrom: "42.0", common: "common" });
  assert.deepEqual(tags, { "Build 41": 41, "Build 42": 42 });
  // Every version the definition offers has a number the rule can be judged against.
  for (const version of zomboid.versions) assert.ok(gameVersionOf(version.upstream), version.id);
});

test("Build 42 reads the highest version folder not above its own major.minor", () => {
  // 42, 42.0, 42.10, 42.20, 42.20.4, 42.21, 42.30, 43 → 42.20.4 was read.
  assert.equal(chosenFolder(["42", "42.0", "42.10", "42.20", "42.20.4", "42.21", "42.30", "43", "common"], b42), "42.20.4");
  // Numbers, not text: 42.10 over 42.9.
  assert.equal(chosenFolder(["42", "42.0", "42.9", "42.10", "42.21"], b42), "42.10");
  // The patch is not compared: 42.20.5 is not "above" 42.20.4.
  assert.equal(chosenFolder(["42.10", "42.20.5"], b42), "42.20.5");
  // Within one major.minor, the highest.
  assert.equal(chosenFolder(["42.20.3", "42.20.9"], b42), "42.20.9");
  // Only newer folders: none.
  assert.equal(chosenFolder(["43", "common"], b42), null);
});

test("the Rawt Building Craft downloads are all laid out for 42.20.4, by the ids in their files — requirements aside", () => {
  const rawt = [
    mod("BuildingCraft", ["42.0", "common"], [info("42.0", "BuildingCraft", { versionMin: "42.00" }), info("common", "BuildingCraft", { versionMin: "42.00" })]),
    mod("BuildingCraft Erika's tiles", ["42.0", "common"], [info("42.0", "BuildingCraftErikastiles", { versionMin: "42.00" })]),
    mod("BuildingCraftPipetteCopy", ["42", "common"], [info("common", "BuildingCraftPipetteCopy")]),
    mod("BB_Tiles_BuildingCraft", ["42.0"], [info("42.0", "BB_Tiles_BuildingCraft", { versionMin: "42.00" })]),
  ];
  assert.deepEqual(
    rawt.map((m) => judgeMod(m, layout, b42)),
    [
      { loads: true, id: "BuildingCraft", name: "BuildingCraft", folder: "42.0" },
      { loads: true, id: "BuildingCraftErikastiles", name: "BuildingCraftErikastiles", folder: "42.0" },
      { loads: true, id: "BuildingCraftPipetteCopy", name: "BuildingCraftPipetteCopy", folder: "common" },
      { loads: true, id: "BB_Tiles_BuildingCraft", name: "BB_Tiles_BuildingCraft", folder: "42.0" },
    ],
  );
});

test("a Build 41 mod is not seen by Build 42, and says so", () => {
  // Building Menu's TryHonesty addon: one mod.info, at the top, versionMax=41.78.
  const menu = mod("BuildingMenuTryHonestysAddon", ["media"], [info("", "BuildingMenuTryHonestysAddon", { versionMax: "41.78" })]);
  const verdict = judgeMod(menu, layout, b42);
  assert.deepEqual(verdict, {
    loads: false,
    id: "BuildingMenuTryHonestysAddon",
    name: "BuildingMenuTryHonestysAddon",
    refusal: { kind: "older-layout" },
  });
  assert.match(refusalText(verdict.loads ? { kind: "older-layout" } : verdict.refusal, "Build 42", "42.20.4"), /older build/);

  // And on its own build it loads: 41.78.19 is not above 41.78.
  assert.equal(judgeMod(menu, layout, b41).loads, true);
});

test("the id comes from the chosen folder's mod.info, and common's only when it has none", () => {
  // common said GeeIdCommon, 42.0 said GeeIdVersion: only GeeIdVersion was found.
  const split = mod("GeeProbeIds", ["42.0", "common"], [info("42.0", "GeeIdVersion"), info("common", "GeeIdCommon")]);
  assert.equal(judgeMod(split, layout, b42).id, "GeeIdVersion");

  // A version folder with no mod.info, and one in common: loaded, from common.
  const commonOnly = mod("GeeProbeSplit", ["42", "common"], [info("common", "GeeProbeSplit")]);
  assert.deepEqual(judgeMod(commonOnly, layout, b42), { loads: true, id: "GeeProbeSplit", name: "GeeProbeSplit", folder: "common" });

  // Only a folder for a newer game, and common: common.
  const future = mod("GeeProbeFuture", ["43", "common"], [info("43", "GeeProbeFuture"), info("common", "GeeProbeFuture")]);
  assert.equal(judgeMod(future, layout, b42).loads, true);
});

test("no falling back to a lower folder, and none to the top", () => {
  // mod.info in 42.0 only; 42.10 is empty and is the one read: not found.
  const gap = mod("GeeProbeGap", ["42.0", "42.10", "common"], [info("42.0", "GeeProbeGap")]);
  assert.deepEqual(judgeMod(gap, layout, b42), {
    loads: false,
    id: "GeeProbeGap",
    name: "GeeProbeGap",
    refusal: { kind: "no-info", folder: "42.10" },
  });

  // Only a folder for a newer game, no common: not found.
  const futureOnly = mod("GeeProbeFutureOnly", ["43"], [info("43", "GeeProbeFutureOnly")]);
  assert.deepEqual(judgeMod(futureOnly, layout, b42).loads, false);

  // A hybrid — a Build 41 mod.info at the top and a 42/ folder — loads from 42/ on Build 42.
  const hybrid = mod("GeeProbeHybrid", ["42", "common"], [info("", "GeeProbeHybrid", { versionMax: "41.78" }), info("42", "GeeProbeHybrid")]);
  assert.deepEqual(judgeMod(hybrid, layout, b42), { loads: true, id: "GeeProbeHybrid", name: "GeeProbeHybrid", folder: "42" });
  // …and from the top on Build 41, which does not read version folders at all.
  assert.deepEqual(judgeMod(hybrid, layout, b41), { loads: true, id: "GeeProbeHybrid", name: "GeeProbeHybrid", folder: "" });
});

test("Build 41 does not read a mod laid out for Build 42", () => {
  const onlyFolders = mod("GeeV42Only", ["42", "common"], [info("42", "GeeV42Only", { versionMin: "42.00" }), info("common", "GeeV42Only", { versionMin: "42.00" })]);
  assert.deepEqual(judgeMod(onlyFolders, layout, b41), {
    loads: false,
    id: "GeeV42Only",
    name: "GeeV42Only",
    refusal: { kind: "newer-layout" },
  });
});

test("versionMin and versionMax bound it, on major.minor", () => {
  const bounded = (bounds: Partial<Pick<ModInfoFacts, "versionMin" | "versionMax">>) =>
    judgeMod(mod("M", ["42"], [info("42", "M", bounds)]), layout, b42);

  // Loaded on 42.20.4:
  assert.equal(bounded({ versionMax: "42.20" }).loads, true);
  assert.equal(bounded({ versionMax: "42.20.3" }).loads, true);
  assert.equal(bounded({ versionMin: "42.20.4" }).loads, true);
  assert.equal(bounded({ versionMin: "42.20.5" }).loads, true);
  assert.equal(bounded({ versionMin: "42.00" }).loads, true);
  // Not found on 42.20.4:
  assert.deepEqual(bounded({ versionMax: "42.19" }), { loads: false, id: "M", name: "M", refusal: { kind: "above-max", bound: "42.19" } });
  assert.deepEqual(bounded({ versionMin: "42.21" }), { loads: false, id: "M", name: "M", refusal: { kind: "below-min", bound: "42.21" } });
  assert.deepEqual(bounded({ versionMin: "43.00" }), { loads: false, id: "M", name: "M", refusal: { kind: "below-min", bound: "43.00" } });

  // Bounds are read from the mod.info the build uses: common's versionMax=41.78 does not matter when 42/ has its own.
  const commonMax = mod("GeeProbeCommonMax", ["42", "common"], [info("42", "GeeProbeCommonMax"), info("common", "GeeProbeCommonMax", { versionMax: "41.78" })]);
  assert.equal(judgeMod(commonMax, layout, b42).loads, true);

  // On Build 41 the same: 41.77 is below, 41.78.20 is not above.
  const top = (bounds: Partial<Pick<ModInfoFacts, "versionMin" | "versionMax">>) => judgeMod(mod("M", [], [info("", "M", bounds)]), layout, b41);
  assert.equal(top({ versionMax: "41.77" }).loads, false);
  assert.equal(top({ versionMin: "41.78.20" }).loads, true);
  assert.equal(top({ versionMin: "42.00" }).loads, false);
});

test("a bound that is not major.minor is refused, as the game refuses it", () => {
  // "invalid game version \"42\"" on 42.20.4; "41" and "abc" the same on 41.78.19.
  for (const [bounds, game] of [
    [{ versionMax: "42" }, b42],
    [{ versionMin: "42" }, b42],
    [{ versionMax: "41" }, b41],
    [{ versionMin: "abc" }, b41],
  ] as const) {
    const folder = game === b42 ? "42" : "";
    const verdict = judgeMod(mod("M", game === b42 ? ["42"] : [], [info(folder, "M", bounds)]), layout, game);
    assert.equal(verdict.loads, false);
    assert.equal(!verdict.loads && verdict.refusal.kind, "bad-bound");
  }
});

test("a game that declares no layout reads the top, whatever the version", () => {
  const folders = mod("M", ["42", "common"], [info("42", "M")]);
  assert.equal(judgeMod(folders, undefined, b42).loads, false);
  assert.equal(judgeMod(mod("M", [], [info("", "M")]), undefined, b42).loads, true);
});

test("a mod whose requirement is missing is not loaded, and neither is one that needs it", () => {
  const needs = (id: string, require: string[]): ModFacts => mod(id, ["42"], [{ ...info("42", id), require }]);
  const [present, missing, chain, listedLater] = judgeServer(
    [needs("GeeReqListed", ["\\GeeProbeVersionOnly"]), needs("GeeReqMissing", ["\\GeeNope"]), needs("GeeReqChain", ["\\GeeReqMissing"]), needs("GeeProbeVersionOnly", [])],
    layout,
    b42,
  );
  // Required and downloaded, wherever it sits in the list: loads.
  assert.equal(present!.loads, true);
  assert.equal(listedLater!.loads, true);
  assert.deepEqual(missing, { loads: false, id: "GeeReqMissing", name: "GeeReqMissing", refusal: { kind: "missing-requirement", requires: ["GeeNope"] } });
  // All the way up: the game logged both as not found.
  assert.deepEqual(!chain!.loads && chain!.refusal, { kind: "missing-requirement", requires: ["GeeReqMissing"] });
});

test("the Rawt collection on 42.20.4: three of its five need tiles it does not carry", () => {
  // The requirements as their mod.info files write them; the game loaded BuildingCraft and the Extension only.
  const rawt = [
    mod("BuildingCraft", ["42.0", "common"], [info("42.0", "BuildingCraft"), info("common", "BuildingCraft")]),
    mod("BuildingCraftPipetteCopy", ["42", "common"], [{ ...info("common", "BuildingCraftPipetteCopy"), require: ["BuildingCraft"] }]),
    mod("BuildingCraft Erika's tiles", ["42.0", "common"], [{ ...info("42.0", "BuildingCraftErikastiles"), require: ["\\BuildingCraft", "\\Erikas_Tiles"] }]),
    mod("BuildingCraft PertsPartyTiles", ["42.0", "common"], [{ ...info("42.0", "BuildingCraftPertsPartyTiles"), require: ["\\BuildingCraft", "\\PertsPartyTiles"] }]),
    mod("BB_Tiles_BuildingCraft", ["42.0"], [{ ...info("42.0", "BB_Tiles_BuildingCraft"), require: ["\\BuildingCraft", "\\B&B_Tiles_Craft"] }]),
  ];
  const verdicts = judgeServer(rawt, layout, b42);
  assert.deepEqual(
    verdicts.map((v) => (v.loads ? v.id : `${v.id} needs ${v.refusal.kind === "missing-requirement" ? v.refusal.requires.join(",") : v.refusal.kind}`)),
    [
      "BuildingCraft",
      "BuildingCraftPipetteCopy",
      "BuildingCraftErikastiles needs Erikas_Tiles",
      "BuildingCraftPertsPartyTiles needs PertsPartyTiles",
      "BB_Tiles_BuildingCraft needs B&B_Tiles_Craft",
    ],
  );
});

test("Build 41 takes the backslash as part of the name", () => {
  // require=\GeeOld41 was not found on 41.78.19; require=GeeOldBare was.
  const [slash, plain] = judgeServer(
    [
      mod("GeeReqSlash41", [], [{ ...info("", "GeeReqSlash41"), require: ["\\GeeOld41"] }]),
      mod("GeeReqUnlisted41", [], [{ ...info("", "GeeReqUnlisted41"), require: ["GeeOldBare"] }]),
      mod("GeeOld41", [], [info("", "GeeOld41")]),
      mod("GeeOldBare", [], [info("", "GeeOldBare")]),
    ],
    layout,
    b41,
  );
  assert.equal(slash!.loads, false);
  assert.equal(plain!.loads, true);
  assert.deepEqual(requiredIds({ require: ["\\GeeOld41"] }, "versioned"), ["GeeOld41"]);
  assert.deepEqual(requiredIds({ require: ["\\GeeOld41"] }, "top"), ["\\GeeOld41"]);
});

test("the Workshop's tags warn about another build, and never about an untagged item", () => {
  // Measured: Steam's own tags on the collection's items, September 2026.
  const rawt = [
    { tags: ["Build 42", "building", "Framework", "Interface", "Textures"] },
    { tags: ["Build 42"] },
    { tags: ["Build 42", "building", "Framework", "Interface", "Textures"] },
    { tags: ["Build 42", "building", "Framework", "Interface", "Textures"] },
    { tags: ["Build 42"] },
    { tags: ["building", "Build 41", "Realistic", "Interface", "Textures", "Framework", "Multiplayer"] },
  ];
  assert.equal(buildSummary(rawt, tags, b42), "5 for Build 42, 1 for Build 41 only");
  assert.equal(buildSummary(rawt, tags, b41), "1 for Build 41, 5 for Build 42 only");
  assert.equal(buildSummary([{ tags: ["Map"] }], tags, b42), null);
  assert.equal(buildSummary([...rawt, { tags: ["Map"] }], tags, b42), "5 for Build 42, 1 for Build 41 only, 1 not tagged with a build");

  assert.deepEqual(otherBuildOnly(["Build 41", "Interface"], tags, b42), ["Build 41"]);
  // Tagged for both: for this one too.
  assert.equal(otherBuildOnly(["Build 41", "Build 42"], tags, b42), null);
  assert.equal(otherBuildOnly(["Interface"], tags, b42), null);
});
