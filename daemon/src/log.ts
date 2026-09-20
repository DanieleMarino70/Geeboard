/* Structured logs for the agent, and the panel's request id carried into
   them.

   The same shape as the panel's (web/src/lib/log.ts) and deliberately its
   own file: this agent's dependencies are Docker and a WebSocket, and a
   shared logging package between two processes that are deployed
   separately would be a third — and the whole of it is a timestamp, a
   level, a message and some fields.

   The panel sends `x-request-id` on every call it makes here. Logging it
   is what turns three processes into one timeline: the click, the panel's
   line, and this machine's. */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;
/* JSON under a service manager, a readable line at a terminal. systemd and
   Docker both give the process a pipe rather than a tty, which is the
   difference that matters. */
const asJson = (process.env.LOG_FORMAT ?? (process.stdout.isTTY ? "text" : "json")) === "json";

export function log(level: Level, message: string, fields: Fields = {}): void {
  if (ORDER[level] < threshold) return;
  const at = new Date().toISOString();
  const entry = { at, level, component: "agent", node: process.env.GEEBOARD_NODE_NAME, msg: message, ...fields };
  const line = asJson
    ? JSON.stringify(entry)
    : `${at.slice(11, 19)} ${level.padEnd(5)} agent${fields.requestId ? ` [${fields.requestId}]` : ""} ${message}` +
      Object.entries(fields)
        .filter(([key, value]) => value !== undefined && key !== "requestId")
        .map(([key, value]) => ` ${key}=${typeof value === "string" && /\s/.test(value) ? JSON.stringify(value) : value}`)
        .join("");
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: Fields) => log("debug", message, fields),
  info: (message: string, fields?: Fields) => log("info", message, fields),
  warn: (message: string, fields?: Fields) => log("warn", message, fields),
  error: (message: string, fields?: Fields) => log("error", message, fields),
};

/** The panel's id for this request, if it looks like one. Only ever a log field. */
export function requestIdOf(headers: Record<string, string | string[] | undefined>): string | undefined {
  const given = headers["x-request-id"];
  const value = Array.isArray(given) ? given[0] : given;
  return value && /^[A-Za-z0-9._-]{8,64}$/.test(value) ? value : undefined;
}
