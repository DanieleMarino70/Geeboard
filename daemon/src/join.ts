import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import process from "node:process";
import { agentFilePath, readAgentFile, writeAgentFile, type AgentFile } from "./agent-file.ts";
import { platformReporter } from "./capabilities.ts";
import { agentVersion, defaultDataRoot } from "./config.ts";
import { DockerEngine } from "./docker.ts";
import { unquote } from "./panel-ca.ts";
import { describeFetchFailure, registerOnce } from "./panel.ts";
import { describeTerminal, loadPty } from "./terminal.ts";

/* npm run join -- <panel address> <registration token> [options]

   Joining a machine to a panel, in one command a person can read.

   Joining again starts from what the last join saved (planJoin). The panel's command carries neither a port nor a data root, and
   the dialog tells somebody to run it again to rebuild or re-register a machine, so a join that built its file from its arguments
   alone put every setting back to its default: a PC installed with -DataRoot D:\GameServers looked under C:\ProgramData after the
   next command, with its servers still running from the old place, a backup that archived an empty folder and succeeded, and a
   restore that replaced the wrong one. Now a data root, a port, the capabilities, the terminal's consent and an address given by
   hand are kept unless the run says otherwise, and the output says what was kept.

   It used to take seven environment variables, one of them an agent
   token generated in the browser and shown once — and because the agent
   read nothing but its environment, that same block had to be pasted
   again every time it started. Here the agent generates its own token,
   works out the address the panel can reach it on, learns its node name
   from the panel, and writes all of it down (agent-file.ts). After this,
   `npm start` is the whole command. */

const DEFAULT_PORT = 8080;

export class JoinUsageError extends Error {}

export interface JoinArgs {
  panelUrl: string;
  registrationToken: string;
  /** Null: worked out from the route to the panel. */
  advertiseUrl: string | null;
  port: number;
  capabilities: string[];
  dataRoot: string | null;
  /* Register and save, then exit rather than start the agent. For an
     install where something else starts it — a systemd unit, a
     scheduled task, a service container — and a join that also started
     the agent would leave two of them, one of which nothing manages. */
  noStart: boolean;
  /* Turn the node terminal on for this machine (terminal.ts). Given here,
     on the machine, by whoever runs the join: the panel's command never
     carries it, so the consent cannot be pasted in from elsewhere. */
  terminal: boolean;
  /** Take the terminal's consent back. Neither this nor --terminal: what the last join had stays. */
  noTerminal: boolean;
  /** The port was named (by --port, or by the port in --advertise), as against being the default. */
  portGiven: boolean;
  /** --capabilities was given, even empty (`none`): what it says replaces what the last join had. */
  capabilitiesGiven: boolean;
  /** Become the node this token is for even though this machine is joined as another. */
  replace: boolean;
}

export const USAGE =
  "Usage: npm run join -- <panel address> <registration token> " +
  "[--advertise http://address:port] [--port 8080] [--capabilities steamcmd,java|none] [--data-root <path>] " +
  "[--terminal | --no-terminal] [--replace] [--no-start]";

function httpOrigin(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JoinUsageError(`${what} is not an address: ${raw}. Include the scheme, like http://10.0.0.5:3000.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new JoinUsageError(`${what} must be http or https.`);
  }
  return url;
}

export function parseJoinArgs(argv: readonly string[]): JoinArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let noStart = false;
  let terminal = false;
  let noTerminal = false;
  let replace = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--no-start") {
      noStart = true;
      continue;
    }
    if (arg === "--terminal") {
      terminal = true;
      continue;
    }
    if (arg === "--no-terminal") {
      noTerminal = true;
      continue;
    }
    if (arg === "--replace") {
      replace = true;
      continue;
    }
    const [flag, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (!["advertise", "port", "capabilities", "data-root"].includes(flag)) {
      throw new JoinUsageError(`Unknown option --${flag}.`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === "") throw new JoinUsageError(`--${flag} needs a value.`);
    options.set(flag, unquote(value));
  }

  if (positional.length !== 2) {
    throw new JoinUsageError("Give the panel address and the registration token, in that order.");
  }
  /* One pair of quotes off each, ASCII or typographic. A command pasted into Command Prompt keeps the single quotes it was
     written with for PowerShell, and one pasted from a document or a chat arrives with curly ones; neither is part of the value. */
  const [panelRaw, registrationToken] = positional.map(unquote) as [string, string];
  const panelUrl = httpOrigin(panelRaw, "The panel address").origin;

  const advertise = options.get("advertise");
  const advertiseUrl = advertise ? httpOrigin(advertise.trim(), "--advertise") : null;

  /* The port the agent listens on follows an explicit port in the
     address it advertises, so the two cannot disagree. An address with
     no port is a proxy in front of the agent, which stays on its default. */
  let port = DEFAULT_PORT;
  let portGiven = false;
  const portOption = options.get("port");
  if (portOption !== undefined) {
    port = Number(portOption);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new JoinUsageError("--port must be a whole number between 1 and 65535.");
    }
    portGiven = true;
  } else if (advertiseUrl?.port) {
    port = Number(advertiseUrl.port);
    portGiven = true;
  }
  if (terminal && noTerminal) throw new JoinUsageError("--terminal and --no-terminal say opposite things.");

  return {
    panelUrl,
    registrationToken,
    advertiseUrl: advertiseUrl ? advertiseUrl.origin : null,
    port,
    capabilities: (options.get("capabilities") ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0 && c !== "none"),
    dataRoot: options.get("data-root") ?? null,
    noStart,
    terminal,
    noTerminal,
    portGiven,
    capabilitiesGiven: options.has("capabilities"),
    replace,
  };
}

/* What this join will write, and what it was kept from.

   The run's own words win over the file, and the file wins over the defaults — except for the node's name: a machine that is
   joined as one node does not become another because a token for another was pasted. The name is sent with the registration, which
   the panel checks before it spends the token ("issued for a different node name"), so a command for the wrong node is refused
   with the token still good, and --replace is how somebody says they mean it. */
export interface JoinPlan {
  dataRoot: string;
  port: number;
  capabilities: string[];
  terminal: boolean;
  /** Given by hand this time, or kept from a join that did; null: worked out from the route to the panel, again. */
  advertiseUrl: string | null;
  /** The name sent to the panel. Null: whatever the token was issued for. */
  nodeName: string | null;
  /** What came from the last join, in words, for the output. */
  kept: string[];
}

export function planJoin(args: JoinArgs, previous: AgentFile | null, env: NodeJS.ProcessEnv, fallbackDataRoot: string): JoinPlan {
  const kept: string[] = [];

  let dataRoot = args.dataRoot ?? env.GEEBOARD_DATA_ROOT ?? null;
  if (dataRoot === null && previous) {
    dataRoot = previous.dataRoot;
    kept.push(`data root ${dataRoot}`);
  }
  dataRoot ??= fallbackDataRoot;

  let port = args.port;
  if (!args.portGiven && previous) {
    port = previous.port;
    kept.push(`port ${port}`);
  }

  let capabilities = args.capabilities;
  if (!args.capabilitiesGiven && previous && previous.capabilities.length > 0) {
    capabilities = previous.capabilities;
    kept.push(`capabilities ${capabilities.join(",")}`);
  }

  let terminal = args.terminal;
  if (!args.terminal && !args.noTerminal && previous?.terminal === true) {
    terminal = true;
    kept.push("node terminal on");
  }

  /* An address given by hand stays, when it still names the port the agent will listen on: a different --port with the old forwarded
     address would advertise one port and listen on another. A worked-out one is worked out again, because it goes stale. */
  let advertiseUrl = args.advertiseUrl;
  if (advertiseUrl === null && previous?.advertiseExplicit === true) {
    let advertisedPort: string | null = null;
    try {
      advertisedPort = new URL(previous.advertiseUrl).port;
    } catch {
      /* an address that does not parse is not kept */
    }
    if (advertisedPort !== null && (advertisedPort === "" || advertisedPort === String(port))) {
      advertiseUrl = previous.advertiseUrl;
      kept.push(`address ${advertiseUrl}`);
    }
  }

  return { dataRoot, port, capabilities, terminal, advertiseUrl, nodeName: previous && !args.replace ? previous.nodeName : null, kept };
}

/** How many server folders a data root holds: what would be left behind if a join pointed somewhere else. */
function foldersIn(root: string): number {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length;
  } catch {
    return 0;
  }
}

/* The agent's address, as the panel would reach it.

   The local address of a connection to the panel is the address of the
   interface on the route between the two — the one the panel sees this
   machine on, whether that is 127.0.0.1 beside it or 192.168.1.20 across
   a LAN. It is wrong behind NAT, where the panel reaches the machine
   through a forwarded port on another address, and --advertise says so. */
export function advertiseFrom(localAddress: string, port: number): string {
  const address = localAddress.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  return address.includes(":") ? `http://[${address}]:${port}` : `http://${address}:${port}`;
}

function localAddressToward(panelUrl: string): Promise<string> {
  const url = new URL(panelUrl);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));

  const attempt = (family?: 4) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port, ...(family ? { family } : {}) });
      socket.setTimeout(5_000);
      socket.once("connect", () => {
        const address = socket.localAddress;
        socket.destroy();
        if (address) resolve(address);
        else reject(new Error("no local address"));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("no answer in 5 seconds"));
      });
      socket.once("error", reject);
    });

  // IPv4 first: the agent listens on 0.0.0.0, which does not answer on ::1.
  return attempt(4).catch(() => attempt());
}

/* A refusal, said in words. Thrown to the end of the program rather than process.exit at the spot: leaving while the
   connection to the panel is still closing ends, on Windows, in an assertion from libuv printed under the message
   ("!(handle->flags & UV_HANDLE_CLOSING)"). The exit code was right and the screen was not. */
class JoinFailure extends Error {}

function fail(message: string): never {
  throw new JoinFailure(message);
}

async function main() {
  let args: JoinArgs;
  try {
    args = parseJoinArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof JoinUsageError)) throw error;
    console.error(`\n${error.message}\n${USAGE}\n`);
    process.exit(2);
  }

  const file = agentFilePath();
  let previous: AgentFile | null = null;
  try {
    previous = readAgentFile(file);
  } catch {
    // A file that cannot be read is not kept: it is what a join is for.
  }
  const plan = planJoin(args, previous, process.env, defaultDataRoot());
  const dataRoot = plan.dataRoot;
  if (previous && previous.dataRoot !== dataRoot) {
    const left = foldersIn(previous.dataRoot);
    if (left > 0) {
      console.warn(
        `The previous data root, ${previous.dataRoot}, holds ${left} folder(s). They stay where they are, and this agent will not see them: ` +
          "servers whose containers are running from there go on running, and the panel's file manager, backups and restores will look in the new root.",
      );
    }
  }
  const engine = new DockerEngine({
    managedLabel: process.env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    dataRoot,
  });

  try {
    await engine.ping();
  } catch {
    fail("Docker is not answering on this machine. Start Docker (Docker Desktop on Windows and macOS) and run this again.");
  }

  let advertiseUrl = plan.advertiseUrl;
  if (!advertiseUrl) {
    try {
      advertiseUrl = advertiseFrom(await localAddressToward(args.panelUrl), plan.port);
    } catch (error) {
      // describeFetchFailure and not the error's message: the one Node raises when both an IPv4 and an IPv6 address refuse is an
      // AggregateError whose message is empty, and "cannot reach the panel at https://… ()" says nothing.
      fail(
        `This machine cannot reach the panel at ${args.panelUrl}: ${describeFetchFailure(error, args.panelUrl)} ` +
          "Check the address, and that the panel is running and reachable from here.",
      );
    }
  }

  /* Checked before registering: once the panel has this machine's new
     token, failing to write it down would leave the node unreachable and
     the registration token spent. */
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const probe = `${file}.${process.pid}.probe`;
    writeFileSync(probe, "", { mode: 0o600 });
    rmSync(probe, { force: true });
  } catch (error) {
    fail(`The agent's settings cannot be written to ${file}: ${(error as Error).message}`);
  }

  const agentToken = randomBytes(32).toString("hex");
  /* From package.json, never from a literal here. A number written by
     hand in a second place is a number that goes stale in one of them:
     `join` used to say 0.1.0 whatever release it was, which a panel one
     line ahead would have refused — the one refusal this rule exists to
     prevent, arriving at the worst moment, on a machine somebody is
     standing at. */
  const version = process.env.GEEBOARD_VERSION ?? agentVersion();
  // Told at registration as it will be told on every heartbeat, so the panel knows from the first moment.
  const terminal = describeTerminal(
    { enabled: plan.terminal, shell: process.env.GEEBOARD_TERMINAL_SHELL || null },
    loadPty(),
  );

  let registration;
  try {
    registration = await registerOnce(
      {
        panelUrl: args.panelUrl,
        registrationToken: args.registrationToken,
        nodeName: plan.nodeName,
        advertiseUrl,
        agentToken,
        version,
        declared: plan.capabilities,
        dataRoot,
        terminal,
      },
      platformReporter(() => engine.info()),
    );
  } catch (error) {
    const message = (error as Error).message;
    if (previous && !args.replace && /different node name/.test(message)) {
      fail(
        `This machine is joined as ${previous.nodeName}, and that token was issued for another node. Nothing was changed and the token is still good: ` +
          `run the command that is for ${previous.nodeName}, or add --replace (-Replace on Windows) to make this machine the other node, ` +
          `which leaves ${previous.nodeName} in the panel with no agent until it is joined again.`,
      );
    }
    fail(
      /^40[01] /.test(message)
        ? `The panel refused this: ${message.slice(4).replace(/\.+$/, "")}. A token works once and expires; ` +
            "create a new one with Nodes → Add a node."
        : `Registering with the panel failed: ${message}`,
    );
  }

  try {
    writeAgentFile(file, {
      panelUrl: args.panelUrl,
      nodeName: registration.node,
      token: agentToken,
      advertiseUrl,
      ...(plan.advertiseUrl !== null ? { advertiseExplicit: true } : {}),
      port: plan.port,
      dataRoot,
      capabilities: plan.capabilities,
      joinedAt: new Date().toISOString(),
      ...(plan.terminal ? { terminal: true } : {}),
    });
  } catch (error) {
    fail(
      `Registered as ${registration.node}, but the settings could not be saved to ${file}: ` +
        `${(error as Error).message}. Create a new token in the panel and run join again.`,
    );
  }

  const start = process.platform === "win32" ? "npm.cmd start" : "npm start";
  console.log(
    [
      "",
      `Joined ${args.panelUrl} as ${registration.node} — ${
        registration.approved ? "already approved" : "approve it in the panel to put it in service"
      }.`,
      /* Registering proved one direction only: this machine reached the
         panel. The panel calls this address back on the first heartbeat
         an agent sends, and says so in the agent's log if it cannot —
         which is where somebody looks when a node will take no servers. */
      `The panel will reach this machine at ${advertiseUrl}. Its first heartbeat checks that it can; ` +
        "the agent's log says so if it cannot.",
      `Settings saved to ${file}.`,
      ...(plan.kept.length > 0 ? [`Kept from the previous join: ${plan.kept.join(", ")}.`] : []),
      terminal.state === "on"
        ? `Node terminal: on, as ${terminal.user} with ${terminal.shell}${terminal.scope === "container" ? " (inside the agent's container)" : ""}.`
        : terminal.state === "unavailable"
          ? `Node terminal: asked for, but not available here — ${terminal.reason}.`
          : "Node terminal: off. Run this with --terminal, or npm run terminal on, to allow shells from the panel.",
      args.noStart
        ? "Not starting the agent (--no-start): whatever installed it starts it."
        : `Starting the agent now. From here on, ${start} in this directory is all it takes.`,
      "",
    ].join("\n"),
  );
  if (args.noStart) return;

  if (process.env.GEEBOARD_DAEMON_TOKEN && process.env.GEEBOARD_NODE_NAME) {
    console.warn(
      "GEEBOARD_DAEMON_TOKEN and GEEBOARD_NODE_NAME are set in this shell, and they win over the file. " +
        "Unset them, or the agent will not use what it just joined with.",
    );
  }

  await import("./index.ts");
}

// Only when run, not when a test imports the pieces above.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof JoinFailure)) throw error;
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  }
}
