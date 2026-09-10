import { capabilities, architecture, load, operatingSystem, resources } from "./capabilities.ts";
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

export function panelClient(config: Config): PanelClient | null {
  const panelUrl = config.panelUrl;
  if (!panelUrl) return null;

  const post = async (path: string, body: unknown) => {
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
  };

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
          const result = await post("/api/v1/nodes/register", {
            token: config.registrationToken,
            name: config.nodeName,
            advertiseUrl: config.advertiseUrl,
            /* The agent's own token, minted by whoever configured this
               machine. The panel stores it encrypted and presents it
               back on every request from here on. */
            agentToken: config.token,
            agentVersion: config.version,
            os: operatingSystem(),
            arch: architecture(),
            capabilities: await capabilities(config.capabilities, config.dataRoot),
            resources: await resources(config.dataRoot),
          });

          console.log(
            `geeboard-daemon: registered with the panel as ${String(result.node)} ` +
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
          await post("/api/v1/nodes/heartbeat", {
            name: config.nodeName,
            token: config.token,
            agentVersion: config.version,
            capabilities: await capabilities(config.capabilities, config.dataRoot),
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

