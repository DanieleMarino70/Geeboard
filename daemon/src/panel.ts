import { capabilities, load, resources, type PlatformReporter } from "./capabilities.ts";
import type { Config } from "./config.ts";

/* The agent's side of the conversation with the panel.

   Everything else in this daemon answers questions. This is the one part
   that asks them, and it exists for two things the pull direction cannot
   do: introduce a machine that the panel has never heard of, and say "I
   am still here" often enough that silence means something.

   Both are optional. A node with no panel URL configured runs exactly as
   it did before — the panel polls it, and somebody attached it by hand.
   Neither failure is fatal: an agent that cannot reach the panel must
   still drive the containers already on it, because the servers running
   on this machine are not the panel's to lose. */

export interface PanelClient {
  register(): Promise<void>;
  startHeartbeat(): () => void;
}

const HEARTBEAT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

/* Registration is retried, because the ordinary case for a new node is
   that it starts before somebody has finished setting the panel up.
   Backing off matters: a fleet of agents all retrying every second
   against a panel that is down is a denial of service somebody paid for
   themselves. */
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

async function post(panelUrl: string, path: string, body: unknown) {
  const response = await fetch(new URL(path, panelUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = (await response.json()) as { message?: string; error?: string };
      detail = parsed.message ?? parsed.error ?? detail;
    } catch {
      /* not JSON; the status text will do */
    }
    throw new Error(`${response.status} ${detail}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export interface Registration {
  /** The name the panel registered — the one the token was issued for. */
  node: string;
  approved: boolean;
}

/* One registration attempt, and its answer or its refusal.

   `nodeName` may be left out: a token is issued for one name, and the
   panel answers with it, which is how `npm run join` learns what this
   machine is called without anybody typing it twice. */
export async function registerOnce(
  request: {
    panelUrl: string;
    registrationToken: string;
    nodeName: string | null;
    advertiseUrl: string;
    agentToken: string;
    version: string;
    declared: string[];
    dataRoot: string;
  },
  platform: PlatformReporter,
): Promise<Registration> {
  const result = await post(request.panelUrl, "/api/v1/nodes/register", {
    token: request.registrationToken,
    ...(request.nodeName ? { name: request.nodeName } : {}),
    advertiseUrl: request.advertiseUrl,
    /* The agent's own token. The panel stores it encrypted and presents
       it back on every request from here on. */
    agentToken: request.agentToken,
    agentVersion: request.version,
    ...(await platform()),
    capabilities: await capabilities(request.declared, request.dataRoot, platform.engineMemory()),
    resources: await resources(request.dataRoot, platform.engineMemory()),
  });
  return { node: String(result.node), approved: result.approved === true };
}

export function panelClient(config: Config, platform: PlatformReporter): PanelClient | null {
  const panelUrl = config.panelUrl;
  if (!panelUrl) return null;

  return {
    async register() {
      if (!config.registrationToken) return;
      if (!config.advertiseUrl) {
        throw new Error(
          "GEEBOARD_ADVERTISE_URL is required to register: the panel has to be told where to reach this node.",
        );
      }

      for (let attempt = 0; ; attempt++) {
        try {
          const result = await registerOnce(
            {
              panelUrl,
              registrationToken: config.registrationToken,
              nodeName: config.nodeName,
              advertiseUrl: config.advertiseUrl,
              agentToken: config.token,
              version: config.version,
              declared: config.capabilities,
              dataRoot: config.dataRoot,
            },
            platform,
          );

          console.log(
            `geeboard-daemon: registered with the panel as ${result.node} ` +
              `(${result.approved ? "approved" : "waiting for approval"})`,
          );
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";

          /* A refused token will be refused again. Retrying it forever
             would bury the one line an operator needs to read. */
          if (message.startsWith("401") || message.startsWith("400")) {
            console.error(`geeboard-daemon: registration refused — ${message}`);
            return;
          }

          const wait = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
          console.warn(
            `geeboard-daemon: registration failed (${message}); retrying in ${wait / 1000}s`,
          );
          await sleep(wait);
        }
      }
    },

    startHeartbeat() {
      let stopped = false;

      const beat = async () => {
        if (stopped) return;
        try {
          await post(panelUrl, "/api/v1/nodes/heartbeat", {
            name: config.nodeName,
            token: config.token,
            agentVersion: config.version,
            /* Sent every beat, not only at registration: a node that
               registered while its engine was down, or whose Docker
               Desktop was switched between Linux and Windows containers,
               corrects itself here without being registered again. */
            ...(await platform()),
            capabilities: await capabilities(config.capabilities, config.dataRoot, platform.engineMemory()),
            // Size too, not only load: a disk grows, and a first reading can be wrong.
            resources: await resources(config.dataRoot, platform.engineMemory()),
            load: await load(config.dataRoot),
          });
        } catch (error) {
          /* Warned, not thrown. The panel being unreachable says nothing
             about whether the containers on this machine are fine, and
             an agent that fell over because it could not phone home
             would turn a monitoring outage into a hosting one. */
          const message = error instanceof Error ? error.message : "unknown error";
          console.warn(`geeboard-daemon: heartbeat failed (${message})`);
        }
      };

      void beat();
      const timer = setInterval(() => void beat(), HEARTBEAT_MS);
      timer.unref?.();

      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

