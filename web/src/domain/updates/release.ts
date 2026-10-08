/* What a published release says about itself, and what that makes of the panel and the agents that are running now.

   Every release carries a small file, release.json, written by the release workflow from the version, the date and release-policy.json (the
   one thing in it a person decides, at the cut). The panel reads the newest one now and then (lib/panel-update-ops.ts) and compares it with
   what it is. Three words, and they mean three different things:

     update       a newer release exists. Nothing is wrong with the one that runs.
     recommended  a newer release exists and the person who cut it says it should be taken soon: a fix that matters, short of a security one.
     security     the one that runs is below `securityFloor`: a problem is known in it and fixed in the release that is out.

   An agent is judged on its own floors, because it is upgraded on its own machine and not every release needs it (docs/upgrading.md,
   "The nodes"): `agentFloor` is the oldest agent the newest panel is meant to work with, and `agentSecurityFloor` the oldest one without a
   known security problem. An agent between them and the newest release is fine, and says nothing.

   Pure: no database, no network. The file is data from outside the panel and is read as that — every field is checked, nothing is trusted to
   be a string, a link is https or it is dropped. */

export type PanelState = "current" | "update" | "recommended" | "security" | "ahead" | "unknown";
export type AgentState = "ok" | "unsupported" | "security" | "unknown";

export interface Release {
  schema: 1;
  /** The newest release: major.minor.patch. */
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  /** The release's page, https. */
  url: string | null;
  /** The changelog, https. */
  changelog: string | null;
  recommended: boolean;
  /** A panel below this has a known security problem. */
  securityFloor: string | null;
  /** The oldest agent the newest panel is meant to work with. */
  agentFloor: string | null;
  /** An agent below this has a known security problem. */
  agentSecurityFloor: string | null;
  /** One sentence from whoever cut it; shown as text. */
  summary: string | null;
}

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

export function parseVersion(text: unknown): Parsed | null {
  if (typeof text !== "string") return null;
  const m = VERSION.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** <0, 0 or >0, as semver orders them: a pre-release is below its release, and numeric identifiers are numbers. Null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

const MAX_TEXT = 300;

function link(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function floor(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  const parsed = parseVersion(value);
  return parsed && parsed.pre.length === 0 ? String(value).trim() : undefined;
}

/** The file as it was read, or the reason it is not one. Strict on what it relies on, quiet about what it does not know: a field added later is ignored. */
export function parseRelease(raw: unknown): { ok: true; release: Release } | { ok: false; why: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, why: "it is not a JSON object" };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1) return { ok: false, why: `its schema is ${JSON.stringify(o.schema)}, and this panel reads 1` };
  const version = parseVersion(o.version);
  if (!version || version.pre.length > 0) return { ok: false, why: "its version is not major.minor.patch" };
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return { ok: false, why: "its date is not YYYY-MM-DD" };
  if (o.recommended !== undefined && typeof o.recommended !== "boolean") return { ok: false, why: "recommended is not true or false" };

  const floors: Record<string, string | null> = {};
  for (const key of ["securityFloor", "agentFloor", "agentSecurityFloor"] as const) {
    const f = floor(o[key]);
    if (f === undefined) return { ok: false, why: `${key} is not major.minor.patch` };
    // A floor above the release itself would call every release, the newest included, insecure.
    if (f !== null && (compareVersions(f, String(o.version)) ?? 1) > 0) return { ok: false, why: `${key} is above the release itself` };
    floors[key] = f;
  }

  const summary = typeof o.summary === "string" ? o.summary.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) || null : null;
  return {
    ok: true,
    release: {
      schema: 1,
      version: String(o.version).trim(),
      date: o.date,
      url: link(o.url),
      changelog: link(o.changelog),
      recommended: o.recommended === true,
      securityFloor: floors.securityFloor ?? null,
      agentFloor: floors.agentFloor ?? null,
      agentSecurityFloor: floors.agentSecurityFloor ?? null,
      summary,
    },
  };
}

export interface PanelVerdict {
  state: PanelState;
  /** One sentence for a page or a message, in the panel's words. */
  says: string;
}

export function classifyPanel(installed: string, release: Release): PanelVerdict {
  const cmp = compareVersions(installed, release.version);
  if (cmp === null) return { state: "unknown", says: `This panel does not know which release it is (${installed}), so it cannot say whether ${release.version} is newer.` };
  const insecure = release.securityFloor !== null && (compareVersions(installed, release.securityFloor) ?? 0) < 0;
  if (insecure) {
    return {
      state: "security",
      says: `This panel is ${installed}, and a security problem is known in every release below ${release.securityFloor}. ${release.version} has the fix.`,
    };
  }
  if (cmp < 0) {
    return release.recommended
      ? { state: "recommended", says: `${release.version} is out, and the release says to take it soon. This panel is ${installed}.` }
      : { state: "update", says: `${release.version} is out. This panel is ${installed}, and nothing is wrong with it.` };
  }
  if (cmp === 0) return { state: "current", says: `This panel is on the newest release, ${installed}.` };
  return { state: "ahead", says: `This panel is ${installed}, newer than the newest release (${release.version}): a build that has not been released.` };
}

export interface AgentVerdict {
  state: AgentState;
  says: string;
}

export function classifyAgent(version: string | null | undefined, release: Release): AgentVerdict {
  if (!version || compareVersions(version, "0.0.0") === null) return { state: "unknown", says: "This agent has not said which release it is." };
  if (release.agentSecurityFloor !== null && (compareVersions(version, release.agentSecurityFloor) ?? 0) < 0) {
    return { state: "security", says: `This agent is ${version}, and a security problem is known in every agent below ${release.agentSecurityFloor}. Upgrade it on its machine.` };
  }
  if (release.agentFloor !== null && (compareVersions(version, release.agentFloor) ?? 0) < 0) {
    return { state: "unsupported", says: `This agent is ${version}, below ${release.agentFloor}, the oldest the newest panel is meant to work with. Upgrade it on its machine.` };
  }
  return { state: "ok", says: `This agent is ${version}.` };
}

/** What the panel's state is worth as a tone on a page. */
export function toneOf(state: PanelState | AgentState): "success" | "info" | "warning" | "danger" | "muted" {
  switch (state) {
    case "security":
      return "danger";
    case "recommended":
    case "unsupported":
      return "warning";
    case "update":
      return "info";
    case "current":
    case "ok":
      return "success";
    default:
      return "muted";
  }
}

/** The one word each state is shown as. */
export const STATE_WORD: Record<PanelState | AgentState, string> = {
  current: "Up to date",
  update: "Update available",
  recommended: "Update recommended",
  security: "Security update",
  ahead: "Not released yet",
  unknown: "Unknown",
  ok: "Supported",
  unsupported: "Below the minimum",
};
