import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FIRST_CONTRACT_AGENT,
  PANEL_CONTRACT,
  checkAgentVersion,
  cleanContract,
  noContractRefusal,
  versionMessage,
  versionReason,
} from "../src/domain/nodes/agent-version.ts";

const AGENT_FILE = new URL("../../daemon/src/contract.ts", import.meta.url);

/* The rule these hold to: a panel and an agent work together when they
   speak the same contract, whatever release each is; an agent that sends
   none is from 0.4.0 or before and is refused, with a sentence that says
   what to run. See src/domain/nodes/agent-version.ts. */

test("an agent with the panel's contract is compatible, on any release", () => {
  assert.equal(checkAgentVersion(PANEL_CONTRACT).verdict, "compatible");
  // A panel three lines ahead that has not raised the contract: the agent needs no upgrade.
  assert.equal(versionMessage("0.7.0", "0.4.1", PANEL_CONTRACT), null);
  assert.equal(versionMessage("1.3.0", "0.4.1", PANEL_CONTRACT), null);
  assert.equal(versionReason(PANEL_CONTRACT), null);
});

test("an agent with another contract is not", () => {
  assert.equal(checkAgentVersion(PANEL_CONTRACT + 1).verdict, "incompatible");
  // A panel that raised it: what an agent of the old number is refused by.
  assert.equal(checkAgentVersion(1, 2).verdict, "incompatible");
  assert.equal(checkAgentVersion(2, 2).verdict, "compatible");
});

test("an agent that sends no contract is refused, whatever release it calls itself", () => {
  for (const none of [undefined, null]) {
    assert.equal(checkAgentVersion(none).verdict, "incompatible");
    assert.equal(checkAgentVersion(none).agentContract, null);
  }
  // The release line used to let these through: 0.4.0 under a 0.4.x panel, an agent of the panel's own number, one that gave no version.
  assert.notEqual(versionMessage("0.4.1", "0.4.0", null), null);
  assert.notEqual(versionMessage("0.11.0", "0.11.0", undefined), null);
  assert.notEqual(versionMessage("0.11.0", "unknown", null), null);
  assert.notEqual(versionMessage("0.11.0", null, null), null);
});

test("something that is not a contract is no contract, and is refused as one", () => {
  for (const nonsense of [0, -1, 1.5, NaN, Infinity, 10_000, "1", true, {}, []]) {
    assert.equal(cleanContract(nonsense), null, String(JSON.stringify(nonsense)));
    assert.equal(checkAgentVersion(nonsense).verdict, "incompatible", String(JSON.stringify(nonsense)));
  }
  assert.equal(cleanContract(1), 1);
  assert.equal(cleanContract(9999), 9999);
});

/* What the registration, the heartbeat and the agent's own log say to an
   agent from before the contract: one sentence with its version, the one
   needed, and the command that upgrades it on each platform. */
test("the refusal says which agent it is, what is needed, and what to run", () => {
  const refusal = noContractRefusal("0.4.0");
  assert.ok(refusal.includes("0.4.0"), "its version");
  assert.ok(refusal.includes(`${FIRST_CONTRACT_AGENT} or later`), "the one needed");
  assert.ok(refusal.includes("sudo bash deploy/linux/install.sh"), "the Linux command");
  assert.ok(refusal.includes("install-node.ps1"), "the Windows one");
  assert.equal(refusal.split(". ").length, 1, `one sentence: ${refusal}`);
  assert.ok(refusal.endsWith("."));
  assert.ok(noContractRefusal(undefined).includes("unknown version"), "an agent that gave no version is still told");
  assert.equal(FIRST_CONTRACT_AGENT, "0.4.1", "the first agent that sends a contract; docs/nodes.md says so");
});

test("the node page's sentence names the agent, the panel, what is needed and how", () => {
  const message = versionMessage("0.11.0", "0.4.0", null)!;
  assert.ok(message.includes("0.4.0") && message.includes("0.11.0"), "both versions");
  assert.ok(message.includes(`${FIRST_CONTRACT_AGENT} or later`));
  assert.ok(message.includes("deploy/linux/install.sh") && message.includes("install-node.ps1"));
  assert.doesNotMatch(message, /release line/);
});

test("a message about another contract names both numbers", () => {
  const byContract = versionMessage("0.4.1", "0.4.1", PANEL_CONTRACT + 1);
  assert.ok(byContract?.includes(`contract ${PANEL_CONTRACT + 1}`), "the agent's");
  assert.ok(byContract?.includes(`contract ${PANEL_CONTRACT}`), "the panel's");
  assert.match(byContract ?? "", /will not put new servers here/);
  assert.doesNotMatch(byContract ?? "", /release line/);
  assert.match(versionReason(null) ?? "", /no contract number/);
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
