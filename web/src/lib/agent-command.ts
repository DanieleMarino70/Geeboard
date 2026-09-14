/* The command that starts a node agent and registers it.

   Deliberately free of server-only imports: the Add a node dialog builds
   it in the browser, and the agent token in it is generated there too.
   That token is the one secret that grants control of every container
   on the machine, and generating it client-side means the panel never
   sends one to a browser — it first arrives at the panel from the node
   itself, at registration, and is encrypted before it is stored. */

/** 2 to 39 lowercase letters, digits and dashes. Shared with registerNode. */
export const NODE_NAME = /^[a-z0-9][a-z0-9-]{1,38}$/;

/* Capabilities the agent measures for itself — see
   daemon/src/capabilities.ts. Offering them as checkboxes would let
   somebody declare IPv6 on a machine that has none, and the measurement
   would be quietly overruled by a claim. */
export const MEASURED_CAPABILITIES: readonly string[] = ["docker", "ipv6", "high-memory"];

export type Shell = "bash" | "powershell";

export interface AgentCommandInput {
  nodeName: string;
  agentToken: string;
  panelUrl: string;
  advertiseUrl: string;
  registrationToken: string;
  capabilities: string[];
}

const DEFAULT_AGENT_PORT = 8080;

/** 64 hex characters from the platform's CSPRNG — browser or Node. */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Why an address will not do, or null when it will. */
export function checkAddress(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Not a URL. Include the scheme: http://10.0.0.5:8080";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use http or https.";
  if (url.pathname !== "/" || url.search || url.hash) return "Just the address — no path.";
  return null;
}

/* Where the panel should reach an agent, before anybody has said.

   Only one case can be answered: a panel on loopback can only be
   reaching an agent on the same machine. Anything else is a guess about
   somebody's network, and a wrong guess here produces a node that
   registers, is approved, and can never be reached — so the field is
   left for a person to fill. */
export function defaultAdvertiseUrl(panelUrl: string): string {
  try {
    const host = new URL(panelUrl).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return `http://127.0.0.1:${DEFAULT_AGENT_PORT}`;
    }
  } catch {
    /* no panel URL to reason from */
  }
  return "";
}

/** The panel URL as a node will be given it: origin only, no trailing slash. */
export function panelOrigin(raw: string): string {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

/* The listening port follows the address the panel was told, so the two
   cannot disagree. Only an explicit port counts: an address without one
   is somebody's reverse proxy on 80 or 443, and the agent behind it is
   still on its own default. */
function agentPort(advertiseUrl: string): number | null {
  try {
    const port = new URL(advertiseUrl).port;
    return port && Number(port) !== DEFAULT_AGENT_PORT ? Number(port) : null;
  } catch {
    return null;
  }
}

function variables(input: AgentCommandInput): Array<[string, string]> {
  const vars: Array<[string, string]> = [
    ["GEEBOARD_NODE_NAME", input.nodeName],
    ["GEEBOARD_DAEMON_TOKEN", input.agentToken],
    ["GEEBOARD_PANEL_URL", panelOrigin(input.panelUrl)],
    ["GEEBOARD_ADVERTISE_URL", input.advertiseUrl.trim().replace(/\/+$/, "")],
    ["GEEBOARD_REGISTRATION_TOKEN", input.registrationToken],
  ];
  const port = agentPort(input.advertiseUrl);
  if (port !== null) vars.push(["GEEBOARD_DAEMON_PORT", String(port)]);
  if (input.capabilities.length > 0) {
    vars.push(["GEEBOARD_CAPABILITIES", [...input.capabilities].sort().join(",")]);
  }
  return vars;
}

/* Single quotes in both shells, so nothing in a value is expanded.

   PowerShell treats the typographic quotes ‘ ’ ‚ ‛ as single quotes too,
   which is how a URL pasted from a document ends a string early. Each is
   escaped by doubling, the same as the ASCII one. */
function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;
}

export function agentCommand(input: AgentCommandInput, shell: Shell): string {
  const vars = variables(input);

  if (shell === "bash") {
    return [
      "# In Geeboard's daemon/ directory, after npm install",
      ...vars.map(([key, value]) => `${key}=${bashQuote(value)} \\`),
      "npm start",
    ].join("\n");
  }

  return [
    "# In Geeboard's daemon\\ directory, after npm install",
    ...vars.map(([key, value]) => `$env:${key} = ${powershellQuote(value)}`),
    /* The agent's default data root is a Unix path; on Windows it would
       land in C:\var\lib. ProgramData is where a machine-wide service
       keeps its data, and Docker Desktop can mount it. */
    `$env:GEEBOARD_DATA_ROOT = "$env:ProgramData\\Geeboard\\servers"`,
    /* npm.cmd rather than npm: PowerShell resolves npm to npm.ps1, which
       the default execution policy on a fresh Windows install refuses
       to run. */
    "npm.cmd start",
  ].join("\n");
}
