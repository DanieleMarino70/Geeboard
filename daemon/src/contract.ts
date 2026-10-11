/* What this agent speaks to the panel.

   One whole number, sent with the agent's version in its registration, in
   every heartbeat and in GET /version. The panel compares it with its own
   (web/src/domain/nodes/agent-version.ts) and works with an agent only
   when the two are equal. Every agent from 0.4.1 sends it; from 0.11 a
   panel refuses an agent that sends none.

   It goes up when — and only when — a panel and an agent one number apart
   would misread each other: a route removed or renamed, a field one side
   now requires, a meaning changed. A field the other side can ignore is not
   a reason. Raising it costs every node an upgrade, so it is a decision,
   and it is written in the CHANGELOG.

   The panel's number and this one are separate constants, because the two
   halves are built and shipped apart. A test in web/ reads both files and
   fails when they differ, so they cannot drift in one checkout. */
export const AGENT_CONTRACT = 1;

/* What this agent can do beyond the contract it speaks, by name, so that a panel can ask for one thing and not for a whole number.

   Sent where the contract is: GET /version, the registration and every heartbeat, as `features`. The contract is still equality, a
   feature is how a capability that a panel may not need arrives without raising it. Adding a name here is adding a field the other
   side can ignore, which is not a reason to raise the contract; a panel that does not read `features` ignores it, as one older than
   the list does.

   `tls` (0.11): this agent answers https on its port as well as plain http, with a certificate of its own whose SHA-256 it sends as
   `tlsFingerprint` beside the list (tls.ts). A panel that knows the feature pins that fingerprint and calls only https from then on;
   one that does not goes on calling plain http, which is still answered. An agent that was given nowhere to keep its key does not
   serve https, and leaves the name out (featuresOf). */
export const AGENT_FEATURES: readonly string[] = ["tls"];

/** What this agent says it does: the list, without `tls` when it is not serving https. */
export function featuresOf(serving: { tls: boolean }): string[] {
  return AGENT_FEATURES.filter((name) => name !== "tls" || serving.tls);
}
