/* What release this panel is.

   One source, package.json, inlined at build time by next.config.ts, so
   the number on the screen is the number that was built and nobody has
   to remember to change a second file. The agent does the same with its
   own package.json — see daemon/src/config.ts.

   The fallback is deliberately not a version: a panel that does not know
   what it is says so. Whether an agent works with it is the contract's
   question, not this number's (domain/nodes/agent-version.ts). */
export const PANEL_VERSION = process.env.GEEBOARD_VERSION || "unknown";
