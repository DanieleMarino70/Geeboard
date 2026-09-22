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

/** An address rather than a name. `new URL` keeps IPv6 in its brackets. */
export function isIpAddress(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return true;
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/* Whether the agent has to be given this panel's certificate authority,
   which one thing decides: an https certificate for an **address** rather
   than a name. No public authority issues those, so Caddy signs it with an
   authority of its own (`tls internal`) — and a node agent is a Node.js
   program whose trust store is the public authorities, so it refuses that
   certificate until it is handed the authority behind it.

   Worked out here, from the address the node is actually being given,
   because it is the only place that knows it. It used to be a paragraph in
   the installation guide explaining when `--panel-ca auto` applied to you,
   which asked somebody adding their first machine to understand certificate
   authorities before they could add it. The panel knows its own address.

   http is not this case: there is no certificate to distrust. Neither is a
   name, whoever signed it — a private authority behind a domain is rare,
   and `--panel-ca <file>` by hand is still how that one is answered. */
export function needsPanelAuthority(panelUrl: string): boolean {
  try {
    const url = new URL(panelUrl.trim());
    return url.protocol === "https:" && isIpAddress(url.hostname);
  } catch {
    return false;
  }
}

function joinArguments(input: JoinCommandInput): string[] {
  const args = [panelOrigin(input.panelUrl), input.registrationToken];
  const advertise = input.advertiseUrl.trim().replace(/\/+$/, "");
  if (advertise) args.push("--advertise", advertise);
  if (input.capabilities.length > 0) args.push("--capabilities", [...input.capabilities].sort().join(","));
  /* Last, because it is the installer's own option rather than one of
     join's, and reads as the footnote it is. */
  if (needsPanelAuthority(input.panelUrl)) args.push("--panel-ca", "auto");
  return args;
}

/* The same values, as PowerShell named parameters. Windows gets one
   command like Linux does rather than four lines to paste in order, and a
   named parameter is what makes a one-line command readable: -Panel and
   -Token say which is which, where two quoted strings in a row do not. */
function windowsArguments(input: JoinCommandInput): string[] {
  const args = ["-Panel", powershellQuote(panelOrigin(input.panelUrl)), "-Token", powershellQuote(input.registrationToken)];
  const advertise = input.advertiseUrl.trim().replace(/\/+$/, "");
  if (advertise) args.push("-Advertise", powershellQuote(advertise));
  if (input.capabilities.length > 0) {
    args.push("-Capabilities", powershellQuote([...input.capabilities].sort().join(",")));
  }
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

/* A flag, and the fixed keywords this generator writes itself, go
   unquoted so they read as the options they are. Everything that came
   from somewhere else — an address, a token, a capability somebody
   ticked — is quoted, always. */
const OWN_LITERAL = /^(--[a-z-]+|auto)$/;

function quoted(args: string[], quote: (value: string) => string): string {
  return args.map((arg) => (OWN_LITERAL.test(arg) ? arg : quote(arg))).join(" ");
}

/* One command per platform. It checks the machine, joins the panel and
   installs the agent as something that starts at boot — see deploy/ for
   what each installer does.

   Linux: a container under systemd. The installer gets the image for this
   release, runs `join` once in a throw-away container with the same mounts
   the service has, installs the unit, and asks the agent whether it came
   up. `bash …` rather than `./…` because a checkout copied from Windows or
   unpacked from a zip has no execute bit on anything, and the installer is
   what repairs that.

   Windows: the checkout itself, as a scheduled task in the signed-in
   account — Docker Desktop lives in that session, so the agent does too.
   The installer installs the dependencies, joins with `--no-start`, and
   registers the task, which is what starts it.

   `-ExecutionPolicy Bypass` is in the Windows command because a fresh
   Windows install refuses to run any .ps1 at all. It applies to that one
   process, and it is the first wall a beginner meets.

   A panel reached at an address rather than a name adds `--panel-ca auto`
   to the Linux command, because that panel's certificate is signed by an
   authority only it has — see needsPanelAuthority. Nobody is asked. */
export function joinCommand(input: JoinCommandInput, shell: Shell): string {
  if (shell === "bash") {
    return [
      "# In a checkout of Geeboard, with Docker running",
      `sudo bash deploy/linux/install.sh ${quoted(joinArguments(input), bashQuote)}`,
    ].join("\n");
  }

  return [
    "# In a checkout of Geeboard, with Docker Desktop running",
    `powershell -ExecutionPolicy Bypass -File .\\deploy\\windows\\install-node.ps1 ${windowsArguments(input).join(" ")}`,
  ].join("\n");
}

/** How the agent is started again on each platform, once installed. */
export function startsAgain(shell: Shell): string {
  return shell === "bash"
    ? "systemctl start geeboard-agent"
    : "the Geeboard Agent task, at every sign-in";
}
