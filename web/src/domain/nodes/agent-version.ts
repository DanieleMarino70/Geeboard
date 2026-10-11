import { bare } from "../text";
/* Whether a panel and an agent are close enough to work together.

   The two halves talk over an HTTP contract that neither of them
   negotiates: the panel asks for a workload in the shape this release
   builds, and the agent answers in the shape this release reads. Nothing
   in that exchange announces a version, so a mismatch does not fail
   loudly — it fails as a field that is quietly absent, hours later, on
   somebody's world.

   The rule, once, in one place:

     A panel and an agent work together when they speak the same
     CONTRACT: an integer, written in the code of each half, that goes up
     only when what one says to the other stops being readable by the
     previous number. The panel's is PANEL_CONTRACT below, the agent's is
     AGENT_CONTRACT in daemon/src/contract.ts, and a test reads both and
     fails when they differ.

     An agent that sends no contract is from 0.4.0 or before, and this
     panel does not work with it at all. Those agents were judged by their
     release line (`major.minor` below 1.0) until 0.10, and every panel
     from 0.5 on already refused them by that rule; 0.11 says so plainly,
     and asks for 0.4.1 or later, the first agent that sends a contract.

   Why not the line any more. The line rule made every minor release an
   upgrade of every agent, including the ones that did not change, and it
   was kept only for agents that predate the contract. A 1.0 that speaks
   one rule is a simpler thing to promise than one that speaks two.

   When to raise it: when a panel and an agent one number apart would
   misread each other — a route removed or renamed, a field one side now
   requires, a meaning changed. Adding something the other side can
   ignore does not raise it. Raising it is a decision that costs every
   node an upgrade, so it is written in the CHANGELOG, in the line that
   every release carries about it.

   Where it is enforced:

   - Registration refuses, both a contract of another number and no
     contract at all. A new machine joining with the wrong agent is a
     mistake worth catching in the terminal where it was made, while
     somebody is still standing there.
   - The heartbeat refuses an agent with no contract, and records the
     version it gave, so the node's page says why. It records and never
     refuses a contract of another number: an upgrade moves the panel
     first and the agents after it, so between those two moments a node
     may be a contract behind, and cutting it off would turn an upgrade
     into an outage. An agent from before the contract has been behind
     every panel since 0.5, so there is no upgrade in flight to protect.
   - Placement refuses, so the node keeps its servers running and takes
     no new ones until it is upgraded.

   The agentFloor of release-policy.json is not part of this. It is what
   the newest panel is meant to work with, said on the Updates page as
   advice; refusing an agent below it would refuse contract-1 agents that
   work, which is what the contract exists to avoid.

   See docs/nodes.md. */

/** What this panel says to an agent and expects of it. See the rule above. */
export const PANEL_CONTRACT = 1;

/** The first agent that sends a contract, and so the oldest this panel works with. */
export const FIRST_CONTRACT_AGENT = "0.4.1";

/** How an agent is upgraded on its machine: docs/upgrading.md, "The nodes". */
export const AGENT_UPGRADE_COMMAND = "sudo bash deploy/linux/install.sh on Linux, install-node.ps1 on Windows";

export type VersionVerdict = "compatible" | "incompatible";

export interface VersionCheck {
  verdict: VersionVerdict;
  panelContract: number;
  /** Null for an agent that said none, which is refused. */
  agentContract: number | null;
}

/* What an agent says its contract is, or null for anything that is not one.

   A contract is a whole number of one or more. Anything else — a string, a
   fraction, zero, a negative, the absence of the field — is an agent that
   has not said one, and is refused as an agent from before the contract.
   The bound is only there so a nonsense number cannot reach a column:
   nobody will raise this ten thousand times. */
export function cleanContract(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null;
}

/* The agent is named by the contract the panel stores of it (null for one
   that sends none). `panelContract` is a parameter only so a test can be a
   panel of another number; the panel itself never passes it. */
export function checkAgentVersion(contract: unknown, panelContract: number = PANEL_CONTRACT): VersionCheck {
  const agentContract = cleanContract(contract);
  return {
    verdict: agentContract === panelContract ? "compatible" : "incompatible",
    panelContract,
    agentContract,
  };
}

/* Why, in a clause that follows a sentence naming the agent, after a
   colon: the numbers that were compared, or that there was none. Null when
   nothing is wrong. Every refusal and banner builds on this, so all of
   them say the same thing about the same mismatch. */
export function versionReason(contract: unknown): string | null {
  const check = checkAgentVersion(contract);
  if (check.verdict === "compatible") return null;
  return check.agentContract === null
    ? `that agent sends no contract number, so it is from before the contract, and this panel works only with agent ${FIRST_CONTRACT_AGENT} or later`
    : `the agent speaks contract ${check.agentContract} and the panel speaks contract ${check.panelContract}`;
}

/* The one sentence an agent from before the contract is refused with, at
   registration and at heartbeat: what it is, what is needed, and the
   command that gets it there. Its own log prints it. */
export function noContractRefusal(agent: string | null | undefined): string {
  return (
    `This panel works only with agent ${FIRST_CONTRACT_AGENT} or later, and this agent is ${agent || "of an unknown version"}, from before the contract: ` +
    `upgrade it on this machine (${AGENT_UPGRADE_COMMAND}) and it will be accepted.`
  );
}

/* One sentence for a person, used by the node page, the placement
   refusal and the dashboard alike — so all of them say the same thing
   about the same mismatch. */
export function versionMessage(panel: string, agent: string | null | undefined, contract: unknown): string | null {
  const check = checkAgentVersion(contract);
  if (check.verdict === "compatible") return null;
  if (check.agentContract === null) {
    return (
      `This node runs agent ${agent || "of an unknown version"}, from before the contract, and the panel is ${panel}: it works only with agent ${FIRST_CONTRACT_AGENT} or later ` +
      `(${AGENT_UPGRADE_COMMAND}), so it refuses this agent's heartbeat and puts no new servers here.`
    );
  }
  return `This node runs agent ${agent}, and the panel is ${panel}: ${bare(versionReason(contract)!)}. The panel will not put new servers here until the agent is upgraded.`;
}
