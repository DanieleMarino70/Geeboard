import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { PANEL_CONTRACT, checkAgentVersion, cleanContract, releaseLine, versionMessage, versionReason } from "../src/domain/nodes/agent-version.ts";

const AGENT_FILE = new URL("../../daemon/src/contract.ts", import.meta.url);

/* The rule these hold to: a panel and an agent work together when they
   speak the same contract; an agent that sends none is judged by its
   release line — `major.minor` below 1.0, the major from 1.0 on. The first
   half of this file is the line, the second the contract.
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

/* ── The contract ─────────────────────────────────────────────────
   An agent that sends a number is judged by the number, whatever release
   it calls itself; one that sends none is judged by its line, as above. */

test("an agent with the panel's contract is compatible, on any line", () => {
  // A panel three lines ahead that has not raised the contract: the agent needs no upgrade.
  assert.equal(checkAgentVersion("0.7.0", "0.4.1", PANEL_CONTRACT).verdict, "compatible");
  assert.equal(checkAgentVersion("1.3.0", "0.4.1", PANEL_CONTRACT).verdict, "compatible");
  assert.equal(checkAgentVersion("0.4.1", "0.4.1", PANEL_CONTRACT).basis, "contract");
});

test("an agent with another contract is not, on the same line", () => {
  assert.equal(checkAgentVersion("0.4.1", "0.4.1", PANEL_CONTRACT + 1).verdict, "incompatible");
  // A panel that raised it: what an agent of the old number is refused by.
  assert.equal(checkAgentVersion("0.5.0", "0.4.1", 1, 2).verdict, "incompatible");
  assert.equal(checkAgentVersion("0.5.0", "0.5.0", 2, 2).verdict, "compatible");
});

test("an agent that sends no contract is judged by its line, exactly as before", () => {
  for (const none of [undefined, null]) {
    assert.equal(checkAgentVersion("0.4.1", "0.4.0", none).verdict, "compatible");
    assert.equal(checkAgentVersion("0.4.1", "0.4.0", none).basis, "release line");
    assert.equal(checkAgentVersion("0.5.0", "0.4.0", none).verdict, "incompatible");
  }
});

test("something that is not a contract is no contract, not a refusal", () => {
  for (const nonsense of [0, -1, 1.5, NaN, Infinity, 10_000, "1", true, {}, []]) {
    assert.equal(cleanContract(nonsense), null, String(JSON.stringify(nonsense)));
    // Judged by the line, which here matches.
    assert.equal(checkAgentVersion("0.4.1", "0.4.0", nonsense as never).verdict, "compatible");
  }
  assert.equal(cleanContract(1), 1);
  assert.equal(cleanContract(9999), 9999);
});

test("the contract decides even when nobody can read the version", () => {
  // Panel and agent both unable to say what release they are; the numbers can still be compared.
  assert.equal(checkAgentVersion("", "unknown", PANEL_CONTRACT).verdict, "compatible");
  assert.equal(checkAgentVersion("", "unknown", PANEL_CONTRACT + 1).verdict, "incompatible");
  // And without one, unknown stays unknown.
  assert.equal(checkAgentVersion("", "unknown", null).verdict, "unknown");
});

test("a message says which criterion decided, and names both numbers", () => {
  const byContract = versionMessage("0.4.1", "0.4.1", PANEL_CONTRACT + 1);
  assert.ok(byContract?.includes(`contract ${PANEL_CONTRACT + 1}`), "the agent's");
  assert.ok(byContract?.includes(`contract ${PANEL_CONTRACT}`), "the panel's");
  assert.doesNotMatch(byContract ?? "", /release line/);

  const byLine = versionMessage("0.5.0", "0.4.0", null);
  assert.match(byLine ?? "", /no contract number/);
  assert.ok(byLine?.includes("0.4.0") && byLine.includes("0.5.0"));

  assert.equal(versionMessage("0.7.0", "0.4.1", PANEL_CONTRACT), null, "nothing to say when they agree");
  assert.equal(versionReason("0.7.0", "0.4.1", PANEL_CONTRACT), null);
});

/* The two halves are built apart, so the number is written in each. One
   checkout must not hold two. Skipped where only web/ exists, which is
   the image build. */
test("the agent's contract is the panel's", { skip: !existsSync(AGENT_FILE) && "daemon/ is not here" }, () => {
  const source = readFileSync(AGENT_FILE, "utf8");
  const written = /export const AGENT_CONTRACT = (\d+);/.exec(source);
  assert.ok(written, "daemon/src/contract.ts says what AGENT_CONTRACT is");
  assert.equal(Number(written[1]), PANEL_CONTRACT, "raise both together, and say so in the CHANGELOG");
});
