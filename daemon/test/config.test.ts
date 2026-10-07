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

/* The agent listens on both families by default: join advertises an IPv6 address when that is what a machine has, and an
   agent that answered on IPv4 only left a panel that could only reach it over IPv6 calling an address nothing held. */
test("the agent listens on every address of both families unless it is told an address", async () => {
  const { DEFAULT_HOST, fallsBackToIPv4 } = await import("../src/config.ts");
  const config = loadConfig(base, () => null);
  assert.equal(config.host, DEFAULT_HOST);
  assert.equal(config.host, "::");
  assert.equal(config.hostExplicit, false);
  const chosen = loadConfig({ ...base, GEEBOARD_DAEMON_HOST: "127.0.0.1" }, () => null);
  assert.equal(chosen.host, "127.0.0.1");
  assert.equal(chosen.hostExplicit, true);
  assert.equal(loadConfig({ ...base, GEEBOARD_DAEMON_HOST: "0.0.0.0" }, () => null).hostExplicit, true, "0.0.0.0 asked for is 0.0.0.0");

  // A machine with no IPv6 cannot bind "::" and listens on IPv4; one that was told an address is never moved off it.
  assert.ok(fallsBackToIPv4("::", false, "EAFNOSUPPORT"));
  assert.ok(fallsBackToIPv4("::", undefined, "EADDRNOTAVAIL"));
  assert.ok(!fallsBackToIPv4("::", true, "EAFNOSUPPORT"), "an address chosen is theirs");
  assert.ok(!fallsBackToIPv4("0.0.0.0", false, "EAFNOSUPPORT"), "nothing to fall back from");
  assert.ok(!fallsBackToIPv4("::", false, "EADDRINUSE"), "a taken port is not the family's fault");
});

test("what Node binds for :: answers on IPv4 as well, on a machine that has both", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => res.end("here"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "::", resolve);
  });
  const { port } = server.address() as { port: number };
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "here", "IPv4 on the dual-stack socket");
    const v6 = await fetch(`http://[::1]:${port}/`).then((r) => r.text(), () => null);
    // A CI container may have no loopback IPv6; where it does, it answers.
    if (v6 !== null) assert.equal(v6, "here");
  } finally {
    server.close();
  }
});
