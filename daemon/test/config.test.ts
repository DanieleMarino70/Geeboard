import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

const base = { GEEBOARD_DAEMON_TOKEN: "c".repeat(40), GEEBOARD_NODE_NAME: "config-node" };

test("numbers from the environment are read, and a typo is a sentence at start rather than NaN", () => {
  const config = loadConfig({ ...base, GEEBOARD_DAEMON_PORT: "9001", GEEBOARD_SAMPLE_MS: "5000", GEEBOARD_PULL_STALL_MS: "30000" }, () => null);
  assert.equal(config.port, 9001);
  assert.equal(config.sampleIntervalMs, 5000);
  assert.equal(config.pullStallMs, 30000);
  assert.equal(loadConfig(base, () => null).port, 8080);

  for (const [name, value] of [
    ["GEEBOARD_DAEMON_PORT", "80a"],
    ["GEEBOARD_DAEMON_PORT", "70000"],
    ["GEEBOARD_PULL_STALL_MS", "two minutes"],
    ["GEEBOARD_TERMINAL_IDLE_MS", "NaN"],
    ["GEEBOARD_TERMINAL_SESSIONS", "0"],
  ] as const) {
    assert.throws(() => loadConfig({ ...base, [name]: value }, () => null), new RegExp(`${name} must be a number`), `${name}=${value}`);
  }
});

test("an empty number is the default, not zero", () => {
  assert.equal(loadConfig({ ...base, GEEBOARD_SAMPLE_MS: "" }, () => null).sampleIntervalMs, 15_000);
});
