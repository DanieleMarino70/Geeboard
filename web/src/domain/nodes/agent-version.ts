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

     An agent that sends no contract — every agent up to 0.4.0 — is
     judged by its RELEASE LINE instead: `major.minor` below 1.0, because
     that is where semantic versioning puts a breaking change while a
     project is still 0.x, and the major from 1.0. So 0.4.0 and 0.4.3 are
     one line, and 0.4.0 and 0.5.0 are not.

   Why two criteria. The line rule made every minor release an upgrade of
   every agent, including the ones that did not change: 0.4.0 shipped an
   agent with no code change in it because the panel's line had moved. A
   contract does not move with the release, so an agent carrying one stays
   good for as many panels as speak the same thing. The line remains for
   the agents that predate it, and they go on being judged exactly as
   before; the first upgrade past 0.4.0 is the last one they force.

   When to raise it: when a panel and an agent one number apart would
   misread each other — a route removed or renamed, a field one side now
   requires, a meaning changed. Adding something the other side can
   ignore does not raise it. Raising it is a decision that costs every
   node an upgrade, so it is written in the CHANGELOG, in the line that
   every release carries about it.

   A version nobody has reported is unknown, which is not the same as
   wrong — the same rule the platform checks follow, and the reason a node
   that has never spoken is not refused on a guess.

   Where it is enforced:

   - Registration refuses. A new machine joining with the wrong agent is
     a mistake worth catching in the terminal where it was made, while
     somebody is still standing there.
   - The heartbeat records and never refuses. An upgrade moves the panel
     first and the agents after it, so between those two moments a node
     may be a contract behind. Cutting them off would turn an upgrade into
     an outage.
   - Placement refuses, so the node keeps its servers running and takes
     no new ones until it is upgraded.

   See docs/nodes.md. */

/** What this panel says to an agent and expects of it. See the rule above. */
export const PANEL_CONTRACT = 1;

export type VersionVerdict = "compatible" | "incompatible" | "unknown";

/** Which criterion decided: what a message has to say, so nobody looks for the wrong number. */
export type VersionBasis = "contract" | "release line";

export interface VersionCheck {
  verdict: VersionVerdict;
  /** Null when the verdict is unknown: nothing was compared. */
  basis: VersionBasis | null;
  /** The line each side is on, for a message that names both. */
  panelLine: string | null;
  agentLine: string | null;
  panelContract: number;
  agentContract: number | null;
}

/* A release line: what may change under you without a major bump.

   Returns null for anything that is not a version, which includes the
   string "unknown" that registration stores when an agent sends none. */
export function releaseLine(version: string | null | undefined): string | null {
  if (typeof version !== "string") return null;

  // A pre-release or build suffix belongs to the version, not to the line.
  const match = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?\s*$/.exec(version);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 ? `0.${minor}` : String(major);
}

/* What an agent says its contract is, or null for anything that is not one.

   A contract is a whole number of one or more. Anything else — a string, a
   fraction, zero, a negative, the absence of the field — is an agent that
   has not said, and is judged by its line, never refused for the shape of
   what it sent. The bound is only there so a nonsense number cannot reach
   a column: nobody will raise this ten thousand times. */
export function cleanContract(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null;
}

/* The agent is named by what the panel stores of it: the version it last
   reported, and the contract it last reported (null for one that sends
   none). `panelContract` is a parameter only so a test can be a panel of
   another number; the panel itself never passes it. */
export function checkAgentVersion(
  panel: string,
  agent: string | null | undefined,
  contract?: number | null,
  panelContract: number = PANEL_CONTRACT,
): VersionCheck {
  const panelLine = releaseLine(panel);
  const agentLine = releaseLine(agent);
  const agentContract = cleanContract(contract);
  const known = { panelLine, agentLine, panelContract, agentContract };

  // The contract decides whenever the agent has one, whatever version it calls itself.
  if (agentContract !== null) {
    return { verdict: agentContract === panelContract ? "compatible" : "incompatible", basis: "contract", ...known };
  }

  // A panel that cannot say what it is has no standing to refuse anybody on its line.
  if (panelLine === null || agentLine === null) {
    return { verdict: "unknown", basis: null, ...known };
  }
  return { verdict: panelLine === agentLine ? "compatible" : "incompatible", basis: "release line", ...known };
}

/* Why, in a clause that follows "…because" or stands after a colon: the
   numbers that were compared, and which criterion they belong to. Null when
   nothing is wrong. Every refusal and banner builds on this, so all of them
   say the same thing about the same mismatch. */
export function versionReason(panel: string, agent: string | null | undefined, contract?: number | null): string | null {
  const check = checkAgentVersion(panel, agent, contract);
  if (check.verdict !== "incompatible") return null;
  return check.basis === "contract"
    ? `the agent speaks contract ${check.agentContract} and the panel speaks contract ${check.panelContract}`
    : `that agent reports no contract number, so its release line decides, and ${agent} (line ${check.agentLine}) is not the panel's line (${check.panelLine})`;
}

/* One sentence for a person, used by the node page, the placement
   refusal and the registration error alike — so all three say the same
   thing about the same mismatch. */
export function versionMessage(panel: string, agent: string | null | undefined, contract?: number | null): string | null {
  const reason = versionReason(panel, agent, contract);
  if (reason === null) return null;
  return `This node runs agent ${agent}, and the panel is ${panel}: ${bare(reason)}. The panel will not put new servers here until the agent is upgraded.`;
}
