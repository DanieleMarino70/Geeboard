/* What went wrong when a call to a node did not get an answer, said so that it can be acted on.

   It said "fra-node-02 is timed out" or "fra-node-02 is unreachable" and nothing more: not whether the agent was not running, the name did
   not resolve, a firewall ate the packet or a certificate was refused, not the address, and "is timed out" is not English. The poller kept
   it as `http://203.0.113.10:8080 fra-node-02 is unreachable.` and the heartbeat's probe stripped the name from the same fault, so the node's
   page showed either form depending on who wrote it last. One place classifies the cause from the codes the network gave and one sentence
   says each; the poller, the probe and every operation use them. Pure: given the error, the address and the time. */

export type ReachFault = "timeout" | "refused" | "unresolved" | "untrusted" | "clock" | "reset" | "unroutable" | "not-agent" | "other";

export interface Classified {
  fault: ReachFault;
  /** The code the network gave, for the log and for the sentence's brackets. */
  code: string | null;
}

/** Every code under an error: fetch puts the real one in `cause`, and a connection to a name with several addresses in `errors`. */
export function codesUnder(error: unknown, seen = new Set<unknown>()): string[] {
  if (typeof error !== "object" || error === null || seen.has(error)) return [];
  seen.add(error);
  const codes: string[] = [];
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string") codes.push(code);
  if (Array.isArray(errors)) for (const one of errors) codes.push(...codesUnder(one, seen));
  codes.push(...codesUnder(cause, seen));
  return codes;
}

const UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
]);
const CLOCK = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID"]);

export function classifyFetchFailure(error: unknown): Classified {
  // fetch's own timeout: the signal's reason, a DOMException named TimeoutError.
  if (error instanceof Error && error.name === "TimeoutError") return { fault: "timeout", code: null };
  const codes = codesUnder(error);
  // The HTTP client refuses a few ports outright (1, 7, 9, 25, 110 …: the fetch standard's list) before it connects, with a message and no code.
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (codes.length === 0 && cause instanceof Error && cause.message === "bad port") return { fault: "other", code: "BAD_PORT" };
  const has = (...wanted: string[]) => codes.find((c) => wanted.includes(c)) ?? null;
  const refused = has("ECONNREFUSED");
  if (refused) return { fault: "refused", code: refused };
  const unresolved = has("ENOTFOUND", "EAI_AGAIN");
  if (unresolved) return { fault: "unresolved", code: unresolved };
  const clock = codes.find((c) => CLOCK.has(c));
  if (clock) return { fault: "clock", code: clock };
  const untrusted = codes.find((c) => UNTRUSTED.has(c));
  if (untrusted) return { fault: "untrusted", code: untrusted };
  const timeout = has("ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT");
  if (timeout) return { fault: "timeout", code: timeout };
  const reset = has("ECONNRESET", "UND_ERR_SOCKET", "EPIPE");
  if (reset) return { fault: "reset", code: reset };
  const route = has("EHOSTUNREACH", "ENETUNREACH");
  if (route) return { fault: "unroutable", code: route };
  return { fault: "other", code: codes[0] ?? null };
}

export interface ReachContext {
  /** The node's name. */
  node: string;
  /** Its address as the panel holds it: where the call went. */
  address: string;
  /** How long the call was given, for "did not answer within N seconds". */
  seconds?: number;
  /** The panel's own clock, which a certificate that is "not yet valid" or "expired" is judged against. */
  now?: Date;
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
}

function originOf(address: string): string {
  try {
    return new URL(address).origin;
  } catch {
    return address;
  }
}

/* The address of a machine, in a sentence about it, taken out: a web address, an IPv4 address with its port, an IPv6 address in brackets
   (an IPv4 address with no port is left, because a four-part version number reads the same, and the sentences write an address as an origin).
   The sentence `describeReach` writes names the agent's address because the person who has to fix it needs it, and that is a
   person who may read the nodes; the same sentence reached a member's toast, a REST error, the audit log and a Discord channel, which told
   them the private address and the port of the endpoint in front of the Docker socket (the audit of 0.9.5). Wherever the sentence goes to
   somebody who is not that person, it goes through this. */
const AGENT_ADDRESS = /\bhttps?:\/\/[^\s)"'<>]+|\[[0-9a-f:.]+\](?::\d+)?|\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/gi;

export function withoutAgentAddress(text: string): string {
  return text.replace(AGENT_ADDRESS, "the agent's address");
}

/** The sentence for a fault. Ends in a full stop, and names the node and the address. */
export function describeReach(classified: Classified, context: ReachContext): string {
  const { node } = context;
  const where = originOf(context.address);
  const bracket = classified.code ? ` (${classified.code})` : "";
  switch (classified.fault) {
    case "timeout":
      return `${node} did not answer${context.seconds ? ` within ${context.seconds} seconds` : ""} (${where}). A firewall, or a machine that is off, looks like this.`;
    case "refused":
      return `${node} refused the connection at ${where}: the agent is not running there, or that is not its port.`;
    case "unresolved":
      return `The name in ${node}'s address does not resolve (${hostOf(context.address)})${bracket}. Check the address the node was joined with.`;
    case "untrusted":
      return `${node} presented a certificate this panel does not trust${bracket}. The agent's certificate has to come from an authority this machine knows.`;
    case "clock":
      return `${node} presented a certificate that has expired or is not valid yet${bracket}. This panel's clock says ${(context.now ?? new Date()).toISOString()}: if that is wrong, the certificate is not.`;
    case "reset":
      return `${node} closed the connection before it answered (${where}).`;
    case "unroutable":
      return `There is no route from this panel to ${node} (${where})${bracket}.`;
    case "not-agent":
      return `${node} answered at ${where}, but not like a Geeboard agent. Check that ${where} is the agent and not another program.`;
    default:
      return `${node} could not be reached at ${where}${bracket}.`;
  }
}
