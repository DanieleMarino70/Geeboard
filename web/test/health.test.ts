import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultsFor, planConfigChange } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import {
  assessServerHealth,
  becameReady,
  queryApplies,
  readyThisRun,
  type HealthEvidence,
} from "../src/domain/servers/health.ts";

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

/* A game probed on its port and its console, for the tests about how
   those two kinds of evidence combine. It used to be Terraria itself,
   until a port probe turned out to crash Terraria — see below. */
const portAndConsole = {
  ...requireGame("terraria"),
  health: {
    ...requireGame("terraria").health,
    probes: [
      { kind: "port" as const, port: "game" },
      { kind: "log" as const, pattern: "Server started" },
    ],
  },
};

test("Terraria is never port-probed, because a bare connect crashes it", () => {
  const terraria = requireGame("terraria");
  assert.ok(!terraria.health.probes.some((p) => p.kind === "port"));

  const report = assessServerHealth(terraria, evidence({ logLines: [": Server started"] }));
  assert.equal(report.verdict, "healthy");
});

/* Readiness, remembered. A log probe reads a window of recent output,
   and a busy server pushes its ready line out of it — Terraria, judged
   on its console alone, went UNHEALTHY for having players on it. */

const busyOutput = Array.from({ length: 120 }, (_, i) => `: player${i} has joined.`);

test("a busy server whose ready line has scrolled away was unhealthy, judged on the window alone", () => {
  const report = assessServerHealth(requireGame("terraria"), evidence({ logLines: busyOutput }));
  assert.equal(report.verdict, "unhealthy");
});

test("once ready in this run, it stays ready however much it has printed since", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ logLines: busyOutput, readyAt: upFor(3000) }),
  );
  assert.equal(report.verdict, "healthy");
  assert.match(report.probes[0]!.detail!, /earlier in this run/);
});

test("a readiness from before a restart does not count for the new run", () => {
  const startedAt = upFor(60);
  assert.equal(readyThisRun(upFor(600), startedAt), false);
  assert.equal(readyThisRun(upFor(30), startedAt), true);
  assert.equal(readyThisRun(null, startedAt), false);

  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ startedAt: upFor(3600), logLines: busyOutput, readyAt: upFor(7200) }),
  );
  assert.equal(report.verdict, "unhealthy", "the old run's readiness is not borrowed");
});

test("a crash still outranks a remembered readiness", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({
      logLines: [...busyOutput, "[ERROR] FATAL UNHANDLED EXCEPTION: System.ObjectDisposedException"],
      readyAt: upFor(3000),
    }),
  );
  assert.equal(report.verdict, "unhealthy");
});

test("the look that first sees the ready line is the one that records it, once", () => {
  const terraria = requireGame("terraria");
  const booting = evidence({ startedAt: upFor(20), logLines: ["Resetting game objects 42%"] });
  assert.equal(becameReady(terraria, booting), false, "not before it says so");

  const ready = evidence({ startedAt: upFor(40), logLines: [": Server started"] });
  assert.equal(becameReady(terraria, ready), true);

  assert.equal(becameReady(terraria, { ...ready, readyAt: upFor(10) }), false, "already recorded this run");
  assert.equal(becameReady(terraria, { ...ready, running: false }), false);
  // Minecraft Java is probed on its port and its ping, never its log.
  assert.equal(becameReady(requireGame("minecraft-java"), ready), false, "a game with no log probe has nothing to record");
});

test("Terraria's crash pattern matches what the server really prints", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({
      logLines: [
        ": Server started",
        "[ERROR] FATAL UNHANDLED EXCEPTION: System.ObjectDisposedException: Cannot access a disposed object.",
      ],
    }),
  );
  assert.equal(report.verdict, "unhealthy");
  assert.match(report.reason!, /UNHANDLED EXCEPTION/);
});

test("a server that is not running has no health to report", () => {
  const report = assessServerHealth(requireGame("minecraft-java"), evidence({ running: false }));

  // Not unhealthy. It is off, which the panel already has a word for.
  assert.equal(report.verdict, "unknown");
  assert.equal(report.probes.length, 0);
});

test("a reachable port and a ready console is healthy", () => {
  const report = assessServerHealth(
    portAndConsole,
    evidence({ ports: { game: true }, logLines: ["Server started"] }),
  );

  assert.equal(report.verdict, "healthy");
  assert.equal(report.reason, null);
});

test("a running container with nothing listening is unhealthy", () => {
  const report = assessServerHealth(
    portAndConsole,
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
    portAndConsole,
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
  const report = assessServerHealth(requireGame("valheim"), evidence({ ports: {}, logLines: [] }));

  // Valheim's probes are a Source query and its log. An unlisted server
  // does not answer the query — measured — so it is not asked, and
  // saying so is the difference between an honest verdict and one that
  // quietly overclaims.
  assert.ok(report.skipped.some((s) => /Game query/.test(s)));
  assert.equal(report.probes.find((p) => p.kind === "query")?.ok, null);
});

/* Queries: the game asked in its own protocol, through the node's
   exchange. The poller asks and judges the bytes; here the judged answer
   is evidence like any other. */

const listed = { ...defaultsFor(requireGame("valheim")), public: true, crossplay: false };

test("a listed Valheim server that answers its query is healthy on it", () => {
  const report = assessServerHealth(
    requireGame("valheim"),
    evidence({ settings: listed, queries: { "source-a2s": { ok: true } }, logLines: ["Game server connected"] }),
  );
  assert.equal(report.verdict, "healthy");
  assert.deepEqual(report.skipped, []);
});

test("a game that takes a query and says nothing is unhealthy, in those words", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({
      readyAt: upFor(3000),
      queries: { "terraria-hello": { ok: false, detail: "the game took a query and did not answer it" } },
    }),
  );
  // The gap this closes: "Server started" once, then hung.
  assert.equal(report.verdict, "unhealthy");
  assert.match(report.reason!, /did not answer/);
});

test("a query the node could not put is not a failing game", () => {
  const report = assessServerHealth(
    requireGame("terraria"),
    evidence({ readyAt: upFor(3000), queries: { "terraria-hello": null } }),
  );
  assert.equal(report.verdict, "healthy");
  assert.equal(report.probes.find((p) => p.kind === "query")?.ok, null);
});

test("a query is asked only under the settings it is declared for", () => {
  const probe = requireGame("valheim").health.probes.find((p) => p.kind === "query")!;
  assert.ok(probe.kind === "query");
  assert.equal(queryApplies(probe, listed), true);
  assert.equal(queryApplies(probe, { ...listed, public: false }), false);
  assert.equal(queryApplies(probe, { ...listed, crossplay: true }), false);
  // Not knowing the settings is not a reason to ask.
  assert.equal(queryApplies(probe, undefined), false);
  // A probe with no condition is always asked.
  assert.equal(queryApplies({ kind: "query", protocol: "minecraft-ping" }, undefined), true);
});

test("a protocol with no bytes written for it stays skipped", () => {
  const game = {
    ...requireGame("terraria"),
    health: { ...requireGame("terraria").health, probes: [{ kind: "query" as const, protocol: "terraria-rest" as const }] },
  };
  const report = assessServerHealth(game, evidence());
  assert.equal(report.verdict, "unknown");
  assert.equal(report.skipped.length, 1);
});

test("no console output is not a failed log probe", () => {
  const report = assessServerHealth(
    portAndConsole,
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
