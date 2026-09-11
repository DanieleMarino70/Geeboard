import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, mergeIni, renderConfig, applyTemplate } from "../src/domain/games/config.ts";
import { installServer, type InstallProgress } from "../src/domain/games/install.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { PlatformError } from "../src/domain/errors.ts";
import type {
  IGameRuntime,
  ProvisionPlan,
  RuntimeRef,
  RuntimeStatus,
} from "../src/domain/runtime/types.ts";

/* The install sequence, against a runtime that records what it was
   asked to do. No Docker, no node, no database — which is the point of
   IGameRuntime being an interface rather than a client. */

interface Recorded {
  provisioned: ProvisionPlan | null;
  started: number;
  destroyed: Array<{ ref: RuntimeRef; withData: boolean }>;
  files: Map<string, string>;
}

function fakeRuntime(options: { failStart?: boolean; failWrite?: boolean } = {}) {
  const recorded: Recorded = {
    provisioned: null,
    started: 0,
    destroyed: [],
    files: new Map(),
  };

  const status = (state: RuntimeStatus["state"]): RuntimeStatus => ({
    id: "workload-1",
    name: "test",
    state,
    exitCode: null,
    oomKilled: false,
    startedAt: "2026-09-10T12:00:00.000Z",
    source: "example/image:1",
  });

  const runtime: IGameRuntime = {
    kind: "DOCKER",
    nodeName: "test-node",
    async ping() {},
    async describe() {
      return { node: "test-node", kind: "DOCKER" as const, engine: "test" };
    },
    async provision(plan) {
      recorded.provisioned = plan;
      return status("stopped");
    },
    async destroy(ref, withData) {
      recorded.destroyed.push({ ref, withData });
      return { workload: true, data: withData };
    },
    async start() {
      recorded.started++;
      if (options.failStart) throw new PlatformError("RUNTIME_REJECTED", "the node refused it");
      return status("running");
    },
    async stop() {
      return status("stopped");
    },
    async restart() {
      return status("running");
    },
    async status() {
      return status("running");
    },
    async sample() {
      return { cpuPct: 0, memUsedMb: 0, memLimitMb: 0, memPct: 0, rxBytes: 0, txBytes: 0 };
    },
    async logs() {
      return [];
    },
    async probePort() {
      return true;
    },
    backups: {
      async create() {
        return { artifact: "x.tar.gz", sizeBytes: 1, checksum: "sha256:x", durationMs: 1 };
      },
      async list() {
        return [];
      },
      async remove() {},
      async restore() {
        return { files: 0 };
      },
    },
    async sendCommand() {},
    consoleUrl() {
      return "ws://test";
    },
    files: {
      async list() {
        return { path: "/", entries: [] };
      },
      async read(_ref, at) {
        const content = recorded.files.get(at);
        if (content === undefined) throw new PlatformError("NOT_FOUND", "no such file");
        return { content, sizeBytes: content.length, truncated: false };
      },
      async write(_ref, at, content) {
        if (options.failWrite) throw new PlatformError("RUNTIME_REJECTED", "read-only filesystem");
        recorded.files.set(at, content);
        return {
          name: at,
          path: at,
          kind: "file" as const,
          sizeBytes: content.length,
          modifiedAt: "2026-09-10T12:00:00.000Z",
          mode: "rw-r--r--",
        };
      },
      async makeDirectory() {},
      async remove() {},
      async move() {},
    },
  };

  return { runtime, recorded };
}

function planFor(serverId = "srv-1"): ProvisionPlan {
  return {
    serverId,
    name: "test",
    source: "example/image:1",
    ports: [{ label: "Game", host: 7777, container: 7777, protocol: "tcp" }],
    memoryMb: 2048,
    cpuLimit: 150,
    env: {},
    start: true,
  };
}

function contextFor(game = requireGame("terraria"), overrides: Partial<{ failStart: boolean; failWrite: boolean }> = {}) {
  const { runtime, recorded } = fakeRuntime(overrides);
  const rendered = renderConfig(game, applyTemplate(game, game.templates[0]!.id));
  const steps: InstallProgress[] = [];

  return {
    recorded,
    steps,
    ctx: {
      game,
      runtime,
      plan: planFor(),
      files: rendered.files,
      report: (p: InstallProgress) => {
        steps.push(p);
      },
    },
  };
}

test("the server is provisioned stopped, configured, then started", async () => {
  const { ctx, recorded, steps } = contextFor();
  const result = await installServer(ctx);

  /* The whole reason the sequence exists: a game reads its config once,
     at boot. Starting before writing it would mean every new server
     ignored the template it was created from. */
  assert.equal(recorded.provisioned?.start, false);
  assert.ok(recorded.files.has("serverconfig.txt"));
  assert.equal(recorded.started, 1);
  assert.equal(result.filesWritten, 1);
  assert.equal(result.state, "running");

  assert.deepEqual(
    steps.map((s) => s.step),
    ["prepare", "provision", "configure", "start"],
  );
});

test("progress runs forwards and ends near the end", async () => {
  const { ctx, steps } = contextFor();
  await installServer(ctx);

  const percents = steps.map((s) => s.percent);
  assert.deepEqual([...percents].sort((a, b) => a - b), percents);
  assert.ok(percents[percents.length - 1]! >= 85);
});

test("a game with no file settings still installs, writing nothing", async () => {
  const { ctx, recorded } = contextFor(requireGame("minecraft-java"));
  const result = await installServer(ctx);

  assert.equal(result.filesWritten, 0);
  assert.equal(recorded.files.size, 0);
  assert.equal(recorded.started, 1);
});

test("a failed start destroys what was made rather than leaving it", async () => {
  const { ctx, recorded } = contextFor(requireGame("terraria"), { failStart: true });

  await assert.rejects(installServer(ctx), (error: PlatformError) => {
    assert.equal(error.code, "SERVER_INSTALLATION_FAILED");
    return true;
  });

  /* A workload that exists in the runtime but not in the panel holds a
     port, is invisible, and cannot be cleaned up from the panel. */
  assert.equal(recorded.destroyed.length, 1);
  assert.equal(recorded.destroyed[0]!.withData, true);
});

test("a failure names the step it failed at", async () => {
  const { ctx } = contextFor(requireGame("terraria"), { failWrite: true });

  await assert.rejects(installServer(ctx), (error: PlatformError) => {
    assert.equal(error.code, "SERVER_INSTALLATION_FAILED");
    assert.equal(error.details?.cause, "RUNTIME_REJECTED");
    return true;
  });
});

test("configuring merges into an existing file rather than replacing it", async () => {
  const { ctx, recorded } = contextFor();
  // A world the game has already written to, with a seed it chose.
  recorded.files.set("serverconfig.txt", "seed=1234567\nmaxplayers=8\n# keep me\n");

  await installServer(ctx);
  const after = recorded.files.get("serverconfig.txt")!;

  // The template's value won where it had one...
  assert.match(after, /^maxplayers=16$/m);
  // ...and everything else survived, including what the game chose.
  assert.match(after, /^seed=1234567$/m);
  assert.match(after, /^# keep me$/m);
});

test("an install cannot silently drop settings it cannot write", () => {
  assert.throws(
    () =>
      applyPatch(
        { path: "config.json", format: "json", entries: [{ section: "", key: "/a", value: "1" }] },
        "{}",
      ),
    (error: PlatformError) => {
      assert.equal(error.code, "SERVER_INSTALLATION_FAILED");
      return true;
    },
  );
});

/* ── INI merging ──────────────────────────────────────────────────── */

test("an INI key is written inside its own section", () => {
  const before = ["[One]", "a=1", "", "[Two]", "b=2"].join("\n");
  const after = mergeIni(before, [
    { section: "Two", key: "b", value: "changed" },
    { section: "One", key: "a", value: "also" },
  ]);

  const lines = after.split("\n");
  const oneAt = lines.indexOf("[One]");
  const twoAt = lines.indexOf("[Two]");
  const aAt = lines.findIndex((l) => l.startsWith("a="));
  const bAt = lines.findIndex((l) => l.startsWith("b="));

  assert.equal(lines[aAt], "a=also");
  assert.equal(lines[bAt], "b=changed");
  // The one that actually matters: a key must not drift into the next
  // section, where it would silently configure something else.
  assert.ok(oneAt < aAt && aAt < twoAt);
  assert.ok(twoAt < bAt);
});

test("a new key lands in its section, not at the end of the file", () => {
  const before = ["[One]", "a=1", "[Two]", "b=2"].join("\n");
  const after = mergeIni(before, [{ section: "One", key: "c", value: "3" }]);

  const lines = after.split("\n");
  assert.ok(lines.indexOf("c=3") < lines.indexOf("[Two]"));
});

test("a section the file does not have is appended whole", () => {
  const after = mergeIni("[One]\na=1\n", [{ section: "New", key: "k", value: "v" }]);
  assert.match(after, /\[New\]/);
  assert.match(after, /^k=v$/m);
  assert.match(after, /^a=1$/m);
});

test("comments and unknown keys survive an INI merge", () => {
  const before = ["; a comment", "[S]", "known=1", "unknown=leave me"].join("\n");
  const after = mergeIni(before, [{ section: "S", key: "known", value: "2" }]);

  assert.match(after, /^; a comment$/m);
  assert.match(after, /^known=2$/m);
  assert.match(after, /^unknown=leave me$/m);
});

test("Palworld's INI settings render into their real section", async () => {
  const palworld = requireGame("palworld");
  const rendered = renderConfig(palworld, applyTemplate(palworld, "coop"));
  const patch = rendered.files.find((f) => f.format === "ini")!;

  const written = applyPatch(patch, "");
  assert.match(written, /\[\/Script\/Pal\.PalGameWorldSettings\]/);
  assert.match(written, /^CaptureRate=2\.0$/m);
  assert.match(written, /^bEnablePlayerToPlayerDamage=false$/m);
});
