import assert from "node:assert/strict";
import { test } from "node:test";
import { games } from "../src/lib/catalog.ts";
import { fitToNode, type WizardNode } from "../src/lib/create-wizard.ts";

/* What the wizard starts a server at on a machine that is not the game's own idea of one. The documented VPS proof ran on a 3.8 GB, two-core
   machine, which the agent counts as a 3 GB node with 200% of CPU, and the only shipped game whose defaults fit it was the one the proof used
   (Terraria). Every other game's first screen asked for a server the node could not take. */

const vps: WizardNode = { name: "vps", ramCommitted: 0, ramTotal: 3, cpuCommitted: 0, cpuTotal: 200, diskCommitted: 0, diskTotal: 40 };
const big: WizardNode = { name: "big", ramCommitted: 4, ramTotal: 64, cpuCommitted: 100, cpuTotal: 1600, diskCommitted: 100, diskTotal: 2000 };

test("a node with room is given the game's own defaults, and nothing is said", () => {
  for (const game of games()) {
    const fit = fitToNode(game, big);
    assert.deepEqual([fit.memoryGb, fit.cpuLimit, fit.diskGb], [game.defaults.memoryGb, game.defaults.cpuLimit, game.defaults.diskGb], game.id);
    assert.deepEqual(fit.lowered, [], game.id);
    assert.deepEqual(fit.short, [], game.id);
  }
});

test("on the 3 GB, two-core VPS every shipped game either starts at what fits or says in numbers what does not", () => {
  const said: string[] = [];
  for (const game of games()) {
    const fit = fitToNode(game, vps);
    const floors = { memory: Math.max(game.limits.memoryGb[0], game.requirements.memoryGbMin), cpu: Math.max(game.limits.cpuLimit[0], game.requirements.cpuPctMin) };
    // Never over what the node has, unless the game's own floor is over it, and then the floor and the sentence.
    if (floors.memory <= 3) assert.ok(fit.memoryGb <= 3, `${game.id} memory ${fit.memoryGb}`);
    else {
      assert.equal(fit.memoryGb, Math.min(game.defaults.memoryGb, floors.memory), game.id);
      assert.ok(fit.short.some((s) => /^memory: the game asks for at least \d+ GB, and vps has 3 GB uncommitted$/.test(s)), `${game.id}: ${fit.short.join(" | ")}`);
    }
    if (floors.cpu <= 200) assert.ok(fit.cpuLimit <= 200, `${game.id} cpu ${fit.cpuLimit}`);
    // Never below the game's floor, which is a decision and not a default.
    assert.ok(fit.memoryGb >= Math.min(game.defaults.memoryGb, floors.memory), game.id);
    assert.ok(fit.cpuLimit >= Math.min(game.defaults.cpuLimit, floors.cpu), game.id);
    // In the units the sliders move in.
    assert.equal(fit.cpuLimit % 50, 0, game.id);
    said.push(`${game.id}: ${fit.memoryGb} GB, ${fit.cpuLimit}%${fit.lowered.length ? ` (${fit.lowered.join(", ")})` : ""}${fit.short.length ? ` — ${fit.short.join("; ")}` : ""}`);
  }
  // The point of it: Minecraft Java, the first game and the one that was preselected, now starts at something the node can take.
  const minecraft = fitToNode(games().find((g) => g.id === "minecraft-java")!, vps);
  assert.equal(minecraft.memoryGb, 3);
  assert.equal(minecraft.cpuLimit, 200);
  assert.deepEqual(minecraft.lowered, ["memory 3 GB instead of 8 GB", "CPU 200% instead of 300%", "storage 40 GB instead of 60 GB"]);
  console.log(said.join("\n"));
});

test("what is committed is not offered: a node that is half promised has half to give", () => {
  const half: WizardNode = { ...big, ramCommitted: 60, ramTotal: 64 };
  const fit = fitToNode(games().find((g) => g.id === "minecraft-java")!, half);
  assert.equal(fit.memoryGb, 4);
});

test("no node, no change", () => {
  const game = games()[0]!;
  assert.deepEqual(fitToNode(game, null), { memoryGb: game.defaults.memoryGb, cpuLimit: game.defaults.cpuLimit, diskGb: game.defaults.diskGb, lowered: [], short: [] });
});
