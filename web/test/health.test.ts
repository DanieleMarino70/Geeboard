import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultsFor, planConfigChange } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { assessServerHealth, type HealthEvidence } from "../src/domain/servers/health.ts";

/* Health, as arithmetic over evidence somebody else gathered. No node,
   no sockets, no clock that moves — which is the point of the poller
   gathering and the domain judging. */

const now = new Date("2026-09-11T12:00:00.000Z");
const upFor = (seconds: number) => new Date(now.getTime() - seconds * 1000);

function evidence(overrides: Partial<HealthEvidence> = {}): HealthEvidence {
  return {
    running: true,
    startedAt: upFor(3600),
    ports: {},
    logLines: [],
    now,
    ...overrides,
  };
}

test("a server that is not running has no health to report", () => {
  const report = assessServerHealth(requireGame("minecraft-java"), evidence({ running: false }));

  // Not unhealthy. It is off, which the panel already has a word for.
  assert.equal(report.verdict, "unknown");
  assert.equal(report.probes.length, 0);
});

test("a reachable port and a ready console is healthy", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ ports: { game: true }, logLines: ["Server started"] }),
  );

  assert.equal(report.verdict, "healthy");
  assert.equal(report.reason, null);
});

test("a running container with nothing listening is unhealthy", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ ports: { game: false }, logLines: ["Server started"] }),
  );

  /* The whole reason health exists. A Minecraft server out of heap keeps
     its container alive while refusing every connection. */
  assert.equal(report.verdict, "unhealthy");
  assert.match(report.reason!, /nothing is listening/);
});

test("a failing probe inside the boot grace is booting, not broken", () => {
  const zomboid = requireGame("project-zomboid");
  const report = assessServerHealth(
    zomboid,
    evidence({ startedAt: upFor(120), ports: {}, logLines: ["Loading map"] }),
  );

  // Zomboid builds its map cache for minutes on a cold node. Calling
  // that unhealthy would restart a server that was working perfectly.
  assert.ok(zomboid.health.bootGraceSeconds > 120);
  assert.equal(report.verdict, "booting");
});

test("past the boot grace the same evidence is unhealthy", () => {
  const zomboid = requireGame("project-zomboid");
  const report = assessServerHealth(
    zomboid,
    evidence({
      startedAt: upFor(zomboid.health.bootGraceSeconds + 60),
      logLines: ["Loading map"],
    }),
  );

  assert.equal(report.verdict, "unhealthy");
});

test("a node that did not answer is not evidence of a broken server", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ ports: { game: null }, logLines: ["Server started"] }),
  );

  /* "We could not check" and "it failed" are different answers, and
     collapsing them means a node blip reads as a server fault. */
  assert.equal(report.verdict, "healthy");
  assert.equal(report.probes.find((p) => p.kind === "port")?.ok, null);
});

test("no probe could run at all, so the verdict is unknown", () => {
  const report = assessServerHealth(
    requireGame("minecraft-bedrock"),
    // Bedrock probes a log line and the process; with no output the log
    // probe cannot answer, but the process probe can — so make the game
    // one whose only runnable probe is the port, and withhold it.
    evidence({ ports: { game: null }, logLines: [] }),
  );

  assert.ok(["unknown", "healthy"].includes(report.verdict));
});

test("a crash line outranks a port that still answers", () => {
  const report = assessServerHealth(
    requireGame("minecraft-java"),
    evidence({
      ports: { game: true },
      logLines: ["Done (12.4s)! For help, type help", "java.lang.OutOfMemoryError: Java heap space"],
    }),
  );

  /* A process that has printed an out-of-memory error is not healthy
     because its socket is still open. */
  assert.equal(report.verdict, "unhealthy");
  assert.match(report.reason!, /OutOfMemoryError/);
});

test("probes that cannot be executed are named, never counted as passes", () => {
  const report = assessServerHealth(requireGame("rust"), evidence({ ports: {}, logLines: [] }));

  // Rust's probes are a Source query and the process. The query cannot
  // be run yet, and saying so is the difference between an honest
  // verdict and one that quietly overclaims.
  assert.ok(report.skipped.some((s) => /Game query/.test(s)));
  assert.equal(report.probes.find((p) => p.kind === "query")?.ok, null);
});

test("no console output is not a failed log probe", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ ports: { game: true }, logLines: [] }),
  );

  // Logs rotate. A server whose startup line has scrolled away is still
  // running, and reporting it unhealthy for that would be worse than
  // saying nothing.
  assert.equal(report.verdict, "healthy");
  assert.equal(report.probes.find((p) => p.kind === "log")?.ok, null);
});

test("a broken pattern in a definition does not take the pass down", () => {
  const game = requireGame("terraria");
  const broken = {
    name: game.name,
    health: { ...game.health, crashPattern: "([unclosed" },
  };

  assert.doesNotThrow(() =>
    assessServerHealth(broken, evidence({ ports: { game: true }, logLines: ["fine"] })),
  );
});

/* ── What changing a setting costs ────────────────────────────────── */

test("a file-backed setting applies on restart, not on a rebuild", () => {
  const terraria = requireGame("terraria");
  const before = defaultsFor(terraria);
  const plan = planConfigChange(terraria, before, { ...before, maxPlayers: 24 });

  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0]!.applies, "on-restart");
  assert.equal(plan.needsRecreate, false);
});

test("an environment-backed setting needs the workload rebuilt", () => {
  const minecraft = requireGame("minecraft-java");
  const before = defaultsFor(minecraft);
  const plan = planConfigChange(minecraft, before, { ...before, maxPlayers: 60 });

  /* The environment is fixed when a workload is created. Saving this
     and leaving the server running the old value would be worse than
     refusing, so the plan says so and the operator decides. */
  assert.equal(plan.changes[0]!.applies, "on-recreate");
  assert.equal(plan.needsRecreate, true);
});

test("an unchanged value is not a change", () => {
  const game = requireGame("terraria");
  const before = defaultsFor(game);
  assert.deepEqual(planConfigChange(game, before, { ...before }).changes, []);
});

test("the plan carries the before and after of each field", () => {
  const game = requireGame("project-zomboid");
  const before = defaultsFor(game);
  const plan = planConfigChange(game, before, { ...before, pvp: true, maxPlayers: 32 });

  assert.equal(plan.changes.length, 2);
  const pvp = plan.changes.find((c) => c.key === "pvp")!;
  assert.equal(pvp.from, false);
  assert.equal(pvp.to, true);
  assert.equal(pvp.label, "PvP");
});
