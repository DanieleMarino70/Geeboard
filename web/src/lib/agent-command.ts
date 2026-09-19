/* The command that joins a machine to this panel.

   Deliberately free of server-only imports: the Add a node dialog builds
   it in the browser.

   It used to be seven environment variables, one of them an agent token
   generated in the browser and shown once, which the agent needed on
   every start after — so losing the command meant registering the
   machine again. Now the agent generates its own token on the machine,
   works out its own address, learns its name from the token, and writes
   all of it down (daemon/src/join.ts). What is left to hand somebody is
   where the panel is and a single-use token. No secret in this command
   outlives its first run, and the agent token never reaches a browser
   at all. */

/** 2 to 39 lowercase letters, digits and dashes. Shared with registerNode. */
export const NODE_NAME = /^[a-z0-9][a-z0-9-]{1,38}$/;

/* Capabilities the agent measures for itself — see
   daemon/src/capabilities.ts. Offering them as checkboxes would let
   somebody declare IPv6 on a machine that has none, and the measurement
   would be quietly overruled by a claim. */
export const MEASURED_CAPABILITIES: readonly string[] = ["docker", "ipv6", "high-memory"];

export type Shell = "bash" | "powershell";

export interface JoinCommandInput {
  panelUrl: string;
  registrationToken: string;
  capabilities: string[];
  /** Empty: the agent works it out from its route to the panel. */
  advertiseUrl: string;
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

/** The panel URL as a node will be given it: origin only, no trailing slash. */
export function panelOrigin(raw: string): string {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}

function joinArguments(input: JoinCommandInput): string[] {
  const args = [panelOrigin(input.panelUrl), input.registrationToken];
  const advertise = input.advertiseUrl.trim().replace(/\/+$/, "");
  if (advertise) args.push("--advertise", advertise);
  if (input.capabilities.length > 0) args.push("--capabilities", [...input.capabilities].sort().join(","));
  return args;
}

/* Single quotes in both shells, so nothing in a value is expanded.

   PowerShell treats the typographic quotes ‘ ’ ‚ ‛ as single quotes too,
   which is how a URL pasted from a document ends a string early. Each is
   escaped by doubling, the same as the ASCII one. */
function bashQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/['‘’‚‛]/g, (q) => q + q)}'`;
}

/* A flag goes unquoted so it reads as one; a value is always quoted. */
function quoted(args: string[], quote: (value: string) => string): string {
  return args.map((arg) => (/^--[a-z-]+$/.test(arg) ? arg : quote(arg))).join(" ");
}

/* The command installs the agent as something that starts at boot, and
   joins on the way — see deploy/ for what each script does.

   Linux: a container under systemd. The install script builds the
   image from the checkout, runs `join` once in a throw-away container
   with the same mounts the service has, and installs the unit.

   Windows: the checkout itself, as a scheduled task in the signed-in
   account — Docker Desktop lives in that session, so the agent does
   too. `join --no-start` registers and saves; the task starts it. */
export function joinCommand(input: JoinCommandInput, shell: Shell): string {
  const args = joinArguments(input);

  if (shell === "bash") {
    return [
      "# In a checkout of Geeboard, with Docker running",
      `sudo deploy/linux/install.sh ${quoted(args, bashQuote)}`,
    ].join("\n");
  }

  /* npm.cmd rather than npm: PowerShell resolves npm to npm.ps1, which the
     default execution policy on a fresh Windows install refuses to run. */
  return [
    "# In a checkout of Geeboard, with Docker Desktop running",
    "cd daemon",
    "npm.cmd install",
    `npm.cmd run join -- ${quoted(args, powershellQuote)} --no-start`,
    "..\\deploy\\windows\\install-agent.ps1",
  ].join("\n");
}

/** How the agent is started again on each platform, once installed. */
export function startsAgain(shell: Shell): string {
  return shell === "bash"
    ? "systemctl start geeboard-agent"
    : "the Geeboard Agent task, at every sign-in";
}
