/* When the agent tries the panel again, and what it says when the panel will not have it.

   The heartbeat was a fixed fifteen seconds whatever happened, and every failure a warning of the same words: a panel that was down for a
   night was 5,760 lines, and a node that was removed, or whose panel was restored from an older dump, or whose token the panel could no
   longer open, printed `heartbeat failed detail="401 Unknown node."` four times a minute for ever with no instruction, while the registration
   loop, which stops at a 401, had always known better. Two kinds of failure, and each its own pace: a refusal will be refused again, so it is
   said once with what to do and tried again only every five minutes (the panel may have been put right); a network failure backs off, doubling
   from the interval to five minutes, with a little jitter so that a hundred agents do not come back to a restarted panel in the same second.
   Pure: the answer in, the wait out. */

export const HEARTBEAT_MS = 15_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export type BeatFailure = "refused" | "network";

/** `post` throws "<status> <detail>" for an answer that was not 2xx, and a sentence about the network for one that did not come. */
export function failureKind(message: string): BeatFailure {
  return /^(401|403|404) /.test(message) ? "refused" : "network";
}

/** What to say to whoever reads the agent's log, once, when the panel refuses it. */
export function refusalFix(message: string): string {
  if (message.startsWith("404")) {
    return "the panel has no such address for a heartbeat: this agent is pointed at something that is not a Geeboard panel of this release, or at a path that is not its address. Check --panel and join again";
  }
  return (
    "the panel does not know this node or does not accept its token: the node was removed, joined again from another process, or the panel was " +
    "restored from an older backup. Join again with a new token (Nodes → Add a node, then run the command it makes), or stop this agent"
  );
}

/**
 * The wait before the next beat. `failures` counts the failures in a row, this one included; 0 is a beat that got through.
 * `random` is given for a test.
 */
export function nextDelay(failures: number, kind: BeatFailure | null, random: () => number = Math.random): number {
  if (failures <= 0 || kind === null) return HEARTBEAT_MS;
  const jitter = (spread: number) => 1 + (random() * 2 - 1) * spread;
  if (kind === "refused") return Math.round(BACKOFF_MAX_MS * jitter(0.1));
  const wait = Math.min(HEARTBEAT_MS * 2 ** failures, BACKOFF_MAX_MS);
  return Math.round(wait * jitter(0.2));
}
