import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentFile } from "../src/agent-file.ts";
import { anyTokenMatches } from "../src/auth.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { RotationError, acceptedTokens, beginRotation, commitRotation } from "../src/rotate.ts";

/* Changing the agent token without taking the node out of service. */

const OLD = "o".repeat(40);
const NEW = "n".repeat(40);

function joined(extra: Partial<AgentFile> = {}): AgentFile {
  return {
    panelUrl: "http://panel.lan:3000",
    nodeName: "fra-node-02",
    token: OLD,
    advertiseUrl: "http://10.0.0.5:8080",
    port: 8080,
    dataRoot: "/var/lib/geeboard/servers",
    capabilities: [],
    joinedAt: "2026-09-20T00:00:00.000Z",
    ...extra,
  };
}

function agent(file: AgentFile = joined(), env: NodeJS.ProcessEnv = { GEEBOARD_AGENT_FILE: "/etc/geeboard/agent.json" }) {
  let saved: AgentFile = file;
  const io = { read: () => saved, write: (_file: string, contents: AgentFile) => void (saved = contents) };
  const config: Config = loadConfig(env, () => saved);
  return { config, io, file: () => saved };
}

test("between begin and commit both tokens open the door", () => {
  const { config, io, file } = agent();
  beginRotation(config, NEW, io);

  assert.deepEqual(acceptedTokens(config), [NEW, OLD]);
  assert.ok(anyTokenMatches(OLD, acceptedTokens(config)));
  assert.ok(anyTokenMatches(NEW, acceptedTokens(config)));
  // Saved before it is accepted, so a restart mid-rotation keeps both.
  assert.equal(file().token, NEW);
  assert.equal(file().previousToken, OLD);
  // The heartbeat presents whatever config.token is, which is now the new one.
  assert.equal(config.token, NEW);
});

test("commit forgets the old token, in memory and on disk", () => {
  const { config, io, file } = agent();
  beginRotation(config, NEW, io);
  assert.equal(commitRotation(config, NEW, io), true);

  assert.deepEqual(acceptedTokens(config), [NEW]);
  assert.equal(anyTokenMatches(OLD, acceptedTokens(config)), false);
  assert.equal("previousToken" in file(), false);
  assert.equal(commitRotation(config, NEW, io), false, "nothing left to commit");
});

test("the old token cannot retire itself in", () => {
  const { config, io } = agent();
  beginRotation(config, NEW, io);
  assert.throws(() => commitRotation(config, OLD, io), RotationError);
  assert.deepEqual(acceptedTokens(config), [NEW, OLD]);
});

test("a rotation interrupted by a restart still accepts both", () => {
  const { config } = agent(joined({ token: NEW, previousToken: OLD }));
  assert.deepEqual(acceptedTokens(config), [NEW, OLD]);
});

test("a token set in the environment is not rotated from the panel", () => {
  const { config, io } = agent(joined(), { GEEBOARD_DAEMON_TOKEN: OLD, GEEBOARD_NODE_NAME: "fra-node-02" });
  assert.throws(() => beginRotation(config, NEW, io), /GEEBOARD_DAEMON_TOKEN/);
  assert.deepEqual(acceptedTokens(config), [OLD]);
});

test("a short token, the same token, or one with a space in it is refused", () => {
  const { config, io } = agent();
  assert.throws(() => beginRotation(config, "short", io), RotationError);
  assert.throws(() => beginRotation(config, OLD, io), /already in use/);
  assert.throws(() => beginRotation(config, `${"x".repeat(20)} ${"y".repeat(20)}`, io), RotationError);
  assert.throws(() => beginRotation(config, 12345, io), RotationError);
  assert.deepEqual(acceptedTokens(config), [OLD]);
});
