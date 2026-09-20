import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTemplate, renderConfig } from "../src/domain/games/config.ts";
import { requireGame, requireVersion } from "../src/domain/games/registry.ts";
import {
  readWorkloadSpec,
  workloadDifferences,
  workloadPlan,
  workloadSpec,
} from "../src/domain/games/workload.ts";

/* What a workload was made from, against what it would be made from now.
   The comparison is how a definition that changed tells the servers
   already running it that they need a rebuild. */

const subject = { id: "srv-1", slug: "aurora", port: 25565, memoryGb: 4, cpuLimit: 200 };

function specFor(gameId: string, versionId: string, overrides: Partial<typeof subject> = {}, creating = false) {
  const game = requireGame(gameId);
  const version = requireVersion(game, versionId);
  const values = applyTemplate(game, game.templates[0]!.id);
  const rendered = renderConfig(game, values, version, creating ? { creating: true } : { includeEmpty: true });
  return workloadSpec(workloadPlan(game, version, { ...subject, ...overrides }, rendered), game);
}

test("a server just created is not told it needs a rebuild", () => {
  /* Creation leaves an unset setting out of the environment; a rebuild
     writes it as empty so a password can be cleared. Same thing. */
  for (const [game, version] of [
    ["minecraft-java", "paper-1-21-4"],
    ["terraria", "vanilla-1-4-5-8"],
    ["valheim", requireGame("valheim").versions[0]!.id],
    ["project-zomboid", "b42"],
    ["minecraft-bedrock", requireGame("minecraft-bedrock").versions[0]!.id],
  ] as const) {
    assert.deepEqual(workloadDifferences(specFor(game, version, {}, true), specFor(game, version)), [], game);
  }
});

test("a secret made fresh for every workload is not a difference", () => {
  const a = specFor("project-zomboid", "b42");
  const b = specFor("project-zomboid", "b42");
  assert.equal("ADMINPASSWORD" in a.env, false);
  assert.deepEqual(workloadDifferences(a, b), []);
});

test("what changed is named in the panel's words, never as an image", () => {
  const built = specFor("minecraft-java", "paper-1-21-4");
  const now = {
    ...built,
    source: "itzg/minecraft-server:some-newer-tag",
    env: { ...built.env, JVM_XX_OPTS: "-XX:MaxRAMPercentage=70", NEW_FLAG: "1" },
    ports: built.ports.map((p, i) => (i === 2 ? { ...p, loopback: !p.loopback } : p)),
  };
  const said = workloadDifferences(built, now);
  assert.deepEqual(said, [
    "the build it runs",
    "2 start-up variables (JVM_XX_OPTS, NEW_FLAG)",
    "how its ports are published",
  ]);
  assert.ok(!said.join(" ").includes("itzg"));
});

/* Found by verify:backups, not here: a JSONB column returns keys in its
   own order, and comparing ports as text called every server stale. */
test("a spec that has been through the database still equals itself", () => {
  const spec = specFor("minecraft-java", "paper-1-21-4");
  const reordered = {
    ...spec,
    ports: spec.ports.map((p) => ({ loopback: p.loopback, protocol: p.protocol, container: p.container, host: p.host })),
  };
  assert.deepEqual(workloadDifferences(reordered, spec), []);
});

test("new limits saved in settings show up as a pending rebuild", () => {
  const said = workloadDifferences(specFor("terraria", "vanilla-1-4-5-8"), specFor("terraria", "vanilla-1-4-5-8", { memoryGb: 6, cpuLimit: 300 }));
  assert.deepEqual(said, ["its memory limit (4 GB → 6 GB)", "its CPU limit (200% → 300%)"]);
});

test("a row with nothing recorded, or something else in the column, is not a spec", () => {
  assert.equal(readWorkloadSpec(null), null);
  assert.equal(readWorkloadSpec({ source: "x" }), null);
  assert.equal(readWorkloadSpec("nonsense"), null);
  const spec = specFor("terraria", "vanilla-1-4-5-8");
  assert.deepEqual(readWorkloadSpec(JSON.parse(JSON.stringify(spec))), spec);
});
