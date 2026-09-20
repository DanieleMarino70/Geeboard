import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

/* Structured logs, one JSON object a line, and an id that follows a
   request from the browser's click to the node that acted on it.

   No logging library: it is a timestamp, a level, a message and some
   fields, written to a stream, and the one thing a library would add that
   this needs — knowing which request a line belongs to — is
   AsyncLocalStorage, which is Node's.

   The id is made by src/proxy.ts for every request, answered back as
   `x-request-id`, carried here for everything the request does, and sent
   on to the node agent with each call, where the agent logs it too. So
   "the backup at 03:00 failed" is one grep across three processes rather
   than three timelines lined up by eye. The poller makes one per pass.

   What is never logged: a password, a token, a secret, a cookie, a
   temporary password. `fields` is for ids, names, counts and durations;
   an error is logged by its message, and a PlatformError's message is
   written for a person and carries no credentials by construction. */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

interface Context {
  requestId: string;
  component: string;
}

const storage = new AsyncLocalStorage<Context>();
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;
/* JSON in production, where something reads it; a line a person can read
   in development, where somebody is. LOG_FORMAT overrides either way. */
const asJson = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "text")) === "json";

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}

/** An id somebody else sent, if it looks like one; otherwise a new one. Never trusted further than a log line. */
export function acceptRequestId(candidate: string | null | undefined): string {
  return candidate && /^[A-Za-z0-9._-]{8,64}$/.test(candidate) ? candidate : newRequestId();
}

/** Everything `fn` does, and everything it awaits, logs under this id. */
export function withRequestId<T>(requestId: string, component: string, fn: () => T): T {
  return storage.run({ requestId, component }, fn);
}

/** The same, for a route handler that is already running: holds for the rest of this request. */
export function enterRequest(requestId: string, component = "panel"): void {
  storage.enterWith({ requestId, component });
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function log(level: Level, message: string, fields: Fields = {}): void {
  if (ORDER[level] < threshold) return;
  const context = storage.getStore();
  const entry = {
    at: new Date().toISOString(),
    level,
    component: context?.component ?? process.env.GEEBOARD_COMPONENT ?? "panel",
    requestId: context?.requestId,
    msg: message,
    ...fields,
  };
  const line = asJson
    ? JSON.stringify(entry)
    : `${entry.at.slice(11, 19)} ${level.padEnd(5)} ${entry.component}${entry.requestId ? ` [${entry.requestId}]` : ""} ${message}` +
      Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
        .join("");
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: Fields) => log("debug", message, fields),
  info: (message: string, fields?: Fields) => log("info", message, fields),
  warn: (message: string, fields?: Fields) => log("warn", message, fields),
  error: (message: string, fields?: Fields) => log("error", message, fields),
};
