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
