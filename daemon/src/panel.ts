import { capabilities, load, resources, type PlatformReporter } from "./capabilities.ts";
import type { Config } from "./config.ts";
import { logger } from "./log.ts";

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
/** How often the agent repeats that the panel cannot reach it. */
const COMPLAIN_EVERY_MS = 300_000;

/* Registration is retried, because the ordinary case for a new node is
   that it starts before somebody has finished setting the panel up.
   Backing off matters: a fleet of agents all retrying every second
   against a panel that is down is a denial of service somebody paid for
   themselves. */
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

/* Why a request to the panel never got an answer.

   Node's fetch raises one message for every one of them — "fetch
   failed" — and puts the reason in `cause`, sometimes under a second
   `cause`, and sometimes inside an AggregateError holding one error per
   address it tried. An operator reading "Registering with the panel
   failed: fetch failed" is told nothing at all, and the case that
   brought this here is the one that looks most like a bug in the
   agent: a panel behind Caddy's `tls internal`, whose certificate is
   perfectly valid and signed by a certificate authority only that
   machine knows about.

   Nothing here reads the request or the response: the token is in the
   body, and a diagnosis is not worth printing a credential for. */
const TLS_UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

/** Every `code` in the chain of causes under an error, outermost first. */
function codesUnder(error: unknown, seen = new Set<unknown>()): string[] {
  if (typeof error !== "object" || error === null || seen.has(error)) return [];
  seen.add(error);

  const codes: string[] = [];
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string") codes.push(code);
  if (Array.isArray(errors)) for (const one of errors) codes.push(...codesUnder(one, seen));
  codes.push(...codesUnder(cause, seen));
  return codes;
}

export function describeFetchFailure(error: unknown, panelUrl: string): string {
  let where = panelUrl;
  let host = panelUrl;
  try {
    const url = new URL(panelUrl);
    where = url.origin;
    host = url.hostname;
  } catch {
    /* an address that will not parse is its own answer; use it as given */
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return `${where} did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`;
  }

  const codes = codesUnder(error);
  const untrusted = codes.find((code) => TLS_UNTRUSTED.has(code));
  if (untrusted) {
    return (
      `the certificate ${where} presented is signed by a certificate authority this machine does not ` +
      `trust (${untrusted}). A panel behind Caddy's \`tls internal\` has a private one: give this agent ` +
      "that authority's root certificate — deploy/linux/install.sh --panel-ca — rather than turning " +
      "certificate checking off."
    );
  }

  const known: Record<string, string> = {
    CERT_HAS_EXPIRED: `the certificate ${where} presented has expired.`,
    ERR_TLS_CERT_ALTNAME_INVALID: `the certificate ${where} presented is for another name, not ${host}.`,
    ECONNREFUSED: `nothing is listening at ${where}.`,
    ECONNRESET: `${where} closed the connection before answering.`,
    ENOTFOUND: `${host} does not resolve from this machine.`,
    EAI_AGAIN: `${host} could not be resolved from this machine right now.`,
    EHOSTUNREACH: `there is no route from this machine to ${host}.`,
    ENETUNREACH: `there is no route from this machine to ${host}.`,
    ETIMEDOUT: `${where} did not answer.`,
    UND_ERR_CONNECT_TIMEOUT: `${where} did not answer.`,
  };
  for (const code of codes) {
    const said = known[code];
    if (said) return `${said} (${code})`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return codes.length > 0 ? `${message} (${codes.join(", ")})` : message;
}

async function post(panelUrl: string, path: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(new URL(path, panelUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(describeFetchFailure(error, panelUrl), { cause: error });
  }

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

          logger.info("registered with the panel", {
            node: result.node,
            state: result.approved ? "approved" : "waiting for approval",
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";

          /* A refused token will be refused again. Retrying it forever
             would bury the one line an operator needs to read. */
          if (message.startsWith("401") || message.startsWith("400")) {
            logger.error("registration refused", { detail: message });
            return;
          }

          const wait = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]!;
          logger.warn("registration failed", { detail: message, retryInMs: wait });
          await sleep(wait);
        }
      }
    },

    startHeartbeat() {
      let stopped = false;
      /* The panel answers a heartbeat with what it found when it called
         this node back. Said once, and then at most every five minutes:
         it is a standing condition, not an event, and a line every
         fifteen seconds would bury the rest of the log. */
      let complainedAt = 0;

      const beat = async () => {
        if (stopped) return;
        try {
          const answer = await post(panelUrl, "/api/v1/nodes/heartbeat", {
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

          /* The one thing this agent cannot find out for itself: whether
             anything can reach it. The panel tries the advertised
             address while it answers a heartbeat, and a node it cannot
             call is a node no server can be placed on — however well
             everything on this side is working. */
          if (answer.reachable === false && Date.now() - complainedAt >= COMPLAIN_EVERY_MS) {
            complainedAt = Date.now();
            logger.warn("the panel cannot reach this node", {
              advertised: config.advertiseUrl ?? "not set",
              detail: typeof answer.reachableDetail === "string" ? answer.reachableDetail : "no reason given",
              fix: "open that address to the panel, or join again with --advertise <address the panel can use>",
            });
          }
        } catch (error) {
          /* Warned, not thrown. The panel being unreachable says nothing
             about whether the containers on this machine are fine, and
             an agent that fell over because it could not phone home
             would turn a monitoring outage into a hosting one. */
          logger.warn("heartbeat failed", { detail: error instanceof Error ? error.message : "unknown error" });
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

