import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import process from "node:process";
import { agentFilePath, writeAgentFile } from "./agent-file.ts";
import { platformReporter } from "./capabilities.ts";
import { defaultDataRoot } from "./config.ts";
import { DockerEngine } from "./docker.ts";
import { registerOnce } from "./panel.ts";

/* npm run join -- <panel address> <registration token> [options]

   Joining a machine to a panel, in one command a person can read.

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
}

export const USAGE =
  "Usage: npm run join -- <panel address> <registration token> " +
  "[--advertise http://address:port] [--port 8080] [--capabilities steamcmd,java] [--data-root <path>]";

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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (!["advertise", "port", "capabilities", "data-root"].includes(flag)) {
      throw new JoinUsageError(`Unknown option --${flag}.`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === "") throw new JoinUsageError(`--${flag} needs a value.`);
    options.set(flag, value);
  }

  if (positional.length !== 2) {
    throw new JoinUsageError("Give the panel address and the registration token, in that order.");
  }
  const [panelRaw, registrationToken] = positional as [string, string];
  const panelUrl = httpOrigin(panelRaw.trim(), "The panel address").origin;

  const advertise = options.get("advertise");
  const advertiseUrl = advertise ? httpOrigin(advertise.trim(), "--advertise") : null;

  /* The port the agent listens on follows an explicit port in the
     address it advertises, so the two cannot disagree. An address with
     no port is a proxy in front of the agent, which stays on its default. */
  let port = DEFAULT_PORT;
  const portOption = options.get("port");
  if (portOption !== undefined) {
    port = Number(portOption);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new JoinUsageError("--port must be a whole number between 1 and 65535.");
    }
  } else if (advertiseUrl?.port) {
    port = Number(advertiseUrl.port);
  }

  return {
    panelUrl,
    registrationToken: registrationToken.trim(),
    advertiseUrl: advertiseUrl ? advertiseUrl.origin : null,
    port,
    capabilities: (options.get("capabilities") ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0),
    dataRoot: options.get("data-root") ?? null,
  };
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

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
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

  const dataRoot = args.dataRoot ?? process.env.GEEBOARD_DATA_ROOT ?? defaultDataRoot();
  const engine = new DockerEngine({
    managedLabel: process.env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    dataRoot,
  });

  try {
    await engine.ping();
  } catch {
    fail("Docker is not answering on this machine. Start Docker (Docker Desktop on Windows and macOS) and run this again.");
  }

  let advertiseUrl = args.advertiseUrl;
  if (!advertiseUrl) {
    try {
      advertiseUrl = advertiseFrom(await localAddressToward(args.panelUrl), args.port);
    } catch (error) {
      fail(
        `This machine cannot reach the panel at ${args.panelUrl} (${(error as Error).message}). ` +
          "Check the address, and that the panel is running and reachable from here.",
      );
    }
  }

  /* Checked before registering: once the panel has this machine's new
     token, failing to write it down would leave the node unreachable and
     the registration token spent. */
  const file = agentFilePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const probe = `${file}.${process.pid}.probe`;
    writeFileSync(probe, "", { mode: 0o600 });
    rmSync(probe, { force: true });
  } catch (error) {
    fail(`The agent's settings cannot be written to ${file}: ${(error as Error).message}`);
  }

  const agentToken = randomBytes(32).toString("hex");
  const version = process.env.GEEBOARD_VERSION ?? "0.1.0";

  let registration;
  try {
    registration = await registerOnce(
      {
        panelUrl: args.panelUrl,
        registrationToken: args.registrationToken,
        nodeName: null,
        advertiseUrl,
        agentToken,
        version,
        declared: args.capabilities,
        dataRoot,
      },
      platformReporter(() => engine.info()),
    );
  } catch (error) {
    const message = (error as Error).message;
    fail(
      /^40[01] /.test(message)
        ? `The panel refused this: ${message.slice(4)}. A token works once and expires; ` +
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
      port: args.port,
      dataRoot,
      capabilities: args.capabilities,
      joinedAt: new Date().toISOString(),
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
      `The panel will reach this machine at ${advertiseUrl}.`,
      `Settings saved to ${file}.`,
      `Starting the agent now. From here on, ${start} in this directory is all it takes.`,
      "",
    ].join("\n"),
  );

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
  await main();
}
