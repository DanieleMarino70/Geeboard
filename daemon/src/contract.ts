/* What this agent speaks to the panel.

   One whole number, sent with the agent's version in its registration, in
   every heartbeat and in GET /version. The panel compares it with its own
   (web/src/domain/nodes/agent-version.ts) and works with an agent only
   when the two are equal; an agent that sends none is judged by its
   release line instead, which is how every agent up to 0.4.0 is judged.

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

   Sent where the contract is: GET /version, the registration and every heartbeat, as `features`. It is empty, because nothing is a
   feature yet: the contract is still equality, a feature is how a capability that a panel may not need arrives without raising it
   (an RCON exchange is the first candidate, and is a contract-2 decision, not this list's). Adding a name here is adding a field the
   other side can ignore, which is not a reason to raise the contract; a panel that does not read `features` ignores it, as one older
   than the list does. The panel records nothing from it until a feature exists for it to ask for. */
export const AGENT_FEATURES: readonly string[] = [];
