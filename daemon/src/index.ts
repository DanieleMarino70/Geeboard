import process from "node:process";
import { platformReporter } from "./capabilities.ts";
import { loadConfig, type Config } from "./config.ts";
import { EXIT_CONFIG, EXIT_FATAL, installCrashHandlers } from "./crash.ts";
import { DockerEngine } from "./docker.ts";
import { sweepLeftovers } from "./leftovers.ts";
import { logger } from "./log.ts";
import { panelClient } from "./panel.ts";
import { Pulls } from "./pulls.ts";
import { buildServer } from "./server.ts";
import { TerminalSessions, loadPty } from "./terminal.ts";

/* The node agent. One of these runs on every machine that hosts game
   servers; the panel is the only thing that talks to it.

   This file is the process: it makes the parts, starts the listener that
   server.ts builds, and owns the port, the signals and how the agent ends. */

installCrashHandlers(process);

const config: Config = loadConfig();
const engine = new DockerEngine({
  managedLabel: config.managedLabel,
  dataRoot: config.dataRoot,
  containerPrefix: config.containerPrefix,
});
/* Image pulls, as jobs the panel starts and then watches — see pulls.ts.
   Checked for stalls every few seconds; a pull that is merely slow is
   left alone. */
const pulls = new Pulls(
  { open: (image) => engine.pullStream(image), present: (image) => engine.hasImage(image) },
  config.pullStallMs,
);
setInterval(() => pulls.checkStalls(), 5_000).unref();
/* One reporter for every route that says what this node is, so /version
   and the heartbeat cannot disagree about it. */
const platform = platformReporter(() => engine.info());
/* Shells of this machine, opened from the panel — see terminal.ts. The
   library is loaded once, here, so a machine without it says so in every
   heartbeat instead of failing the first person who opens one. */
const terminal = new TerminalSessions(
  { enabled: config.terminal, shell: config.terminalShell, ...config.terminalLimits },
  loadPty(),
);

const agent = buildServer({ config, engine, pulls, platform, terminal });
const { server } = agent;

/* The ways listening can fail, said in a sentence. A taken port is the usual
   one — a second agent, or the first one still running — and it ends with a
   code the service unit does not restart on: starting again in five seconds
   would fail the same way for as long as anybody left it. */
server.on("error", (error: NodeJS.ErrnoException) => {
  const where = `${config.host}:${config.port}`;
  const sentences: Record<string, string> = {
    EADDRINUSE: `${where} is already in use. Most likely an agent is already running on this machine; stop it, or choose another port with GEEBOARD_DAEMON_PORT.`,
    EACCES: `This account may not listen on ${where}. A port above 1024 needs no special rights: set GEEBOARD_DAEMON_PORT.`,
    EADDRNOTAVAIL: `${config.host} is not an address of this machine. GEEBOARD_DAEMON_HOST is where the agent listens; 0.0.0.0 is every address.`,
  };
  const sentence = sentences[error.code ?? ""];
  if (sentence) {
    logger.error(sentence, { code: error.code, address: where });
    process.exit(EXIT_CONFIG);
  }
  logger.error("the agent's listener failed", { code: error.code, detail: error.message });
  process.exit(EXIT_FATAL);
});

server.listen(config.port, config.host, () => {
  logger.info("agent listening", {
    node: config.nodeName,
    address: `${config.host}:${config.port}`,
    sampleMs: config.sampleIntervalMs,
    label: config.managedLabel,
    version: config.version,
    pullStallMs: config.pullStallMs,
    terminal: terminal.describe().state,
  });
  if (config.retiredPullTimeout) {
    logger.warn(
      "GEEBOARD_PULL_TIMEOUT_MS is set and no longer read: a pull is not bounded by how long it takes, only by how long it goes without moving — GEEBOARD_PULL_STALL_MS",
    );
  }
});

/* What a killed process left behind — a half-written archive, an upload, a
   restore's staging directory — goes at start, when nothing is in flight, and
   what has not been touched for hours goes every six after that. Not awaited:
   a node with a great many leftovers should answer while it clears them. */
const sweep = (startup: boolean) =>
  sweepLeftovers(config.dataRoot, { startup }).catch((error: unknown) =>
    logger.warn("clearing leftovers failed", { detail: error instanceof Error ? error.message : String(error) }),
  );
void sweep(true);
setInterval(() => void sweep(false), 6 * 3600_000).unref();

/* Introducing itself to the panel, if it has been told where one is.

   Deliberately after listen(): registration hands the panel an address
   it will start calling, so the agent had better already be answering
   on it. Deliberately not awaited, either — a panel that is down must
   delay nothing here, because the containers on this machine do not
   need the panel to keep running. */
const panel = panelClient(config, platform, () => terminal.describe());
let stopHeartbeat: (() => void) | null = null;

if (panel) {
  void panel.register().then(() => {
    stopHeartbeat = panel.startHeartbeat();
  });
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // A second signal is somebody who does not want to wait for the first.
    if (stopping) {
      logger.warn("stopping now", { signal });
      process.exit(1);
    }
    stopping = true;
    logger.info("shutting down", { signal });
    stopHeartbeat?.();
    // Every shell first: a session is not recovered after a restart, so none may outlive this process.
    terminal.closeAll("the agent is stopping");
    void agent.shutdown().then(() => process.exit(0));
  });
}
