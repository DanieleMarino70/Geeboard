import assert from "node:assert/strict";
import { test } from "node:test";
import type Docker from "dockerode";
import { tokenMatches } from "../src/auth.ts";
import { cpuPercent, demultiplex, mapState, toSample } from "../src/docker.ts";

/* Builds a Docker log frame: 1 byte stream type, 3 padding, 4-byte
   big-endian length, then the payload. */
function frame(text: string, stderr = false): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stderr ? 2 : 1;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

test("demultiplex splits a single frame into lines", () => {
  const lines: Array<[string, boolean]> = [];
  demultiplex(frame("first\nsecond\n"), (line, stderr) => lines.push([line, stderr]));
  assert.deepEqual(lines, [
    ["first", false],
    ["second", false],
  ]);
});

test("demultiplex keeps stdout and stderr apart", () => {
  const lines: Array<[string, boolean]> = [];
  const chunk = Buffer.concat([frame("out\n"), frame("err\n", true)]);
  demultiplex(chunk, (line, stderr) => lines.push([line, stderr]));
  assert.deepEqual(lines, [
    ["out", false],
    ["err", true],
  ]);
});

test("demultiplex handles several frames in one chunk", () => {
  const lines: string[] = [];
  const chunk = Buffer.concat([frame("a\n"), frame("b\n"), frame("c\n")]);
  demultiplex(chunk, (line) => lines.push(line));
  assert.deepEqual(lines, ["a", "b", "c"]);
});

test("demultiplex ignores a truncated trailing frame", () => {
  const lines: string[] = [];
  // A complete frame followed by a header promising more than is present.
  const partial = Buffer.concat([frame("kept\n"), frame("dropped\n").subarray(0, 10)]);
  demultiplex(partial, (line) => lines.push(line));
  assert.deepEqual(lines, ["kept"]);
});

test("demultiplex drops empty lines rather than emitting blanks", () => {
  const lines: string[] = [];
  demultiplex(frame("a\n\n\nb\n"), (line) => lines.push(line));
  assert.deepEqual(lines, ["a", "b"]);
});

test("demultiplex tolerates CRLF", () => {
  const lines: string[] = [];
  demultiplex(frame("one\r\ntwo\r\n"), (line) => lines.push(line));
  assert.deepEqual(lines, ["one", "two"]);
});

const stats = (over: Record<string, unknown> = {}) =>
  ({
    cpu_stats: {
      cpu_usage: { total_usage: 2_000_000, percpu_usage: [1, 2, 3, 4] },
      system_cpu_usage: 20_000_000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1_000_000, percpu_usage: [1, 2, 3, 4] },
      system_cpu_usage: 10_000_000,
    },
    memory_stats: { usage: 600 * 1024 * 1024, limit: 1024 * 1024 * 1024, stats: { cache: 100 * 1024 * 1024 } },
    networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } },
    ...over,
  }) as unknown as Docker.ContainerStats;

test("cpuPercent scales the delta by the core count", () => {
  // 1M of 10M system delta across 4 cores = 40%.
  assert.equal(cpuPercent(stats()), 40);
});

test("cpuPercent returns 0 on the first reading, when there is no delta", () => {
  const first = stats({
    precpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 20_000_000 },
  });
  assert.equal(cpuPercent(first), 0);
});

test("cpuPercent never reports a negative after a counter reset", () => {
  const reset = stats({
    cpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 10, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 9_000_000 }, system_cpu_usage: 90_000_000 },
  });
  assert.equal(cpuPercent(reset), 0);
});

test("toSample excludes page cache from memory used", () => {
  const s = toSample(stats());
  // 600 MB usage minus 100 MB cache.
  assert.equal(s.memUsedMb, 500);
  assert.equal(s.memLimitMb, 1024);
  assert.equal(s.memPct, 48.8);
});

test("toSample sums every network interface", () => {
  const s = toSample(
    stats({ networks: { eth0: { rx_bytes: 10, tx_bytes: 20 }, eth1: { rx_bytes: 5, tx_bytes: 7 } } }),
  );
  assert.equal(s.rxBytes, 15);
  assert.equal(s.txBytes, 27);
});

test("toSample survives a container with no memory limit", () => {
  const s = toSample(stats({ memory_stats: { usage: 1024 * 1024, limit: 0 } }));
  assert.equal(s.memPct, 0);
});

const inspect = (state: Record<string, unknown>) =>
  ({ State: state }) as unknown as Docker.ContainerInspectInfo;

test("mapState reads running, stopped and restarting", () => {
  assert.equal(mapState(inspect({ Running: true, Paused: false })), "running");
  assert.equal(mapState(inspect({ Running: false, ExitCode: 0 })), "stopped");
  // A restarting container is on its way up, whatever it exited with.
  assert.equal(mapState(inspect({ Running: false, Restarting: true, ExitCode: 0 })), "starting");
  assert.equal(mapState(inspect({ Running: false, Restarting: true, ExitCode: 1 })), "starting");
});

test("mapState treats an application exit code as a crash", () => {
  assert.equal(mapState(inspect({ Running: false, ExitCode: 1 })), "crashed");
  assert.equal(mapState(inspect({ Running: false, ExitCode: 2 })), "crashed");
});

test("mapState does not call a signalled shutdown a crash", () => {
  // 143 is SIGTERM, what `docker stop` sends first.
  assert.equal(mapState(inspect({ Running: false, ExitCode: 143 })), "stopped");
  assert.equal(mapState(inspect({ Running: false, ExitCode: 130 })), "stopped");
  // 137 is SIGKILL, which `docker stop` escalates to when a server does
  // not handle SIGTERM. Verified against a real container.
  assert.equal(mapState(inspect({ Running: false, ExitCode: 137 })), "stopped");
});

test("mapState reports an out-of-memory kill as a crash", () => {
  assert.equal(mapState(inspect({ Running: false, ExitCode: 137, OOMKilled: true })), "crashed");
  assert.equal(mapState(inspect({ Running: false, ExitCode: 0, OOMKilled: true })), "crashed");
});

test("tokenMatches accepts the right token and rejects everything else", () => {
  const token = "a".repeat(48);
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches("b".repeat(48), token), false);
  assert.equal(tokenMatches("", token), false);
  assert.equal(tokenMatches("a".repeat(47), token), false, "shorter token rejected");
  assert.equal(tokenMatches("a".repeat(49), token), false, "longer token rejected");
});
