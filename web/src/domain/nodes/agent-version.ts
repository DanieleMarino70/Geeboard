/* Whether a panel and an agent are close enough to work together.

   The two halves talk over an HTTP contract that neither of them
   negotiates: the panel asks for a workload in the shape this release
   builds, and the agent answers in the shape this release reads. Nothing
   in that exchange announces a version, so a mismatch does not fail
   loudly — it fails as a field that is quietly absent, hours later, on
   somebody's world.

   The rule, once, in one place:

     A panel and an agent work together when they share a release line.
     Below 1.0 a line is `major.minor`, because that is where semantic
     versioning puts a breaking change while a project is still 0.x.
     From 1.0 a line is the major.

   So 0.1.0 and 0.1.4 are one line; 0.1.0 and 0.2.0 are not. A version
   nobody has reported is unknown, which is not the same as wrong — the
   same rule the platform checks follow, and the reason a node that has
   never spoken is not refused on a guess.

   Where it is enforced:

   - Registration refuses. A new machine joining with the wrong agent is
     a mistake worth catching in the terminal where it was made, while
     somebody is still standing there.
   - The heartbeat records and never refuses. An upgrade moves the panel
     first and the agents after it, so between those two moments every
     node is one line behind. Cutting them off would turn an upgrade into
     an outage.
   - Placement refuses, so the node keeps its servers running and takes
     no new ones until it is upgraded.

   See docs/nodes.md. */

export type VersionVerdict = "compatible" | "incompatible" | "unknown";

export interface VersionCheck {
  verdict: VersionVerdict;
  /** The line each side is on, for a message that names both. */
  panelLine: string | null;
  agentLine: string | null;
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

export function checkAgentVersion(panel: string, agent: string | null | undefined): VersionCheck {
  const panelLine = releaseLine(panel);
  const agentLine = releaseLine(agent);

  // A panel that cannot say what it is has no standing to refuse anybody.
  if (panelLine === null || agentLine === null) {
    return { verdict: "unknown", panelLine, agentLine };
  }
  return {
    verdict: panelLine === agentLine ? "compatible" : "incompatible",
    panelLine,
    agentLine,
  };
}

/* One sentence for a person, used by the node page, the placement
   refusal and the registration error alike — so all three say the same
   thing about the same mismatch. */
export function versionMessage(panel: string, agent: string | null | undefined): string | null {
  const check = checkAgentVersion(panel, agent);
  if (check.verdict !== "incompatible") return null;
  return `This node runs agent ${agent}, and the panel is ${panel}. They are different release lines, so the panel will not put new servers here until the agent is upgraded.`;
}
