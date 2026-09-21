import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAgentVersion, releaseLine, versionMessage } from "../src/domain/nodes/agent-version.ts";

/* The rule these hold to: a panel and an agent work together when they
   share a release line — `major.minor` below 1.0, the major from 1.0 on.
   See src/domain/nodes/agent-version.ts. */

test("below 1.0 a line is major.minor, because that is where a break lands", () => {
  assert.equal(releaseLine("0.1.0"), "0.1");
  assert.equal(releaseLine("0.1.7"), "0.1");
  assert.equal(releaseLine("0.2.0"), "0.2");
});

test("from 1.0 a line is the major", () => {
  assert.equal(releaseLine("1.0.0"), "1");
  assert.equal(releaseLine("1.4.2"), "1");
  assert.equal(releaseLine("2.0.0"), "2");
});

test("a tag, a pre-release and a two-part version are still versions", () => {
  assert.equal(releaseLine("v0.1.0"), "0.1");
  assert.equal(releaseLine("0.1.0-rc.1"), "0.1");
  assert.equal(releaseLine("1.2.0+build.9"), "1");
  assert.equal(releaseLine("0.1"), "0.1");
});

test("anything that is not a version has no line", () => {
  // What registration stores when an agent sends none.
  assert.equal(releaseLine("unknown"), null);
  assert.equal(releaseLine(""), null);
  assert.equal(releaseLine(null), null);
  assert.equal(releaseLine(undefined), null);
  assert.equal(releaseLine("latest"), null);
});

test("one line is compatible, another is not", () => {
  assert.equal(checkAgentVersion("0.1.0", "0.1.0").verdict, "compatible");
  assert.equal(checkAgentVersion("0.1.0", "0.1.9").verdict, "compatible");
  assert.equal(checkAgentVersion("0.1.0", "0.2.0").verdict, "incompatible");
  assert.equal(checkAgentVersion("0.2.0", "0.1.0").verdict, "incompatible");
  assert.equal(checkAgentVersion("1.0.0", "1.9.0").verdict, "compatible");
  assert.equal(checkAgentVersion("1.0.0", "0.1.0").verdict, "incompatible");
});

/* The same reason `os === null` is not a refusal: a node that has not
   said is not a node that answered wrongly. */
test("a version nobody reported is unknown, not wrong", () => {
  assert.equal(checkAgentVersion("0.1.0", null).verdict, "unknown");
  assert.equal(checkAgentVersion("0.1.0", "unknown").verdict, "unknown");
  assert.equal(versionMessage("0.1.0", null), null);
});

test("a panel that cannot say what it is refuses nobody", () => {
  assert.equal(checkAgentVersion("", "0.1.0").verdict, "unknown");
  assert.equal(checkAgentVersion("not-a-version", "0.9.0").verdict, "unknown");
});

test("the message names both versions, so nobody has to go and look", () => {
  const message = versionMessage("0.2.0", "0.1.0");
  assert.ok(message?.includes("0.1.0"), "the agent's");
  assert.ok(message?.includes("0.2.0"), "the panel's");
  assert.equal(versionMessage("0.1.0", "0.1.3"), null, "nothing to say when they match");
});
