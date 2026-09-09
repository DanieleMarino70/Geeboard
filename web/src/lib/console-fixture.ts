/* Console output fixture. Stands in for the daemon's WebSocket
   stream until the agent that tails container stdout exists. */

export type LogLevel = "INFO" | "WARN" | "ERROR" | "JOIN" | "LEFT" | "CMD" | "CHAT";

export interface LogLine {
  time: string;
  level: LogLevel;
  message: string;
}

/* ANSI severity is mapped onto the semantic palette rather than raw
   terminal colours, so output stays readable in light mode. */
export const LOG_COLOUR: Record<LogLevel, { level: string; message: string }> = {
  INFO: { level: "text-con-dim", message: "text-con-ink" },
  WARN: { level: "text-warning", message: "text-warning" },
  ERROR: { level: "text-danger", message: "text-danger" },
  JOIN: { level: "text-info", message: "text-con-ink" },
  LEFT: { level: "text-info", message: "text-con-dim" },
  CMD: { level: "text-accent", message: "text-accent" },
  CHAT: { level: "text-ink-3", message: "text-con-ink" },
};

/* Game servers write the level into the line itself; there is no
   structured channel to read it from, so it is recovered by shape. */
export function classifyServerLine(line: string, stderr: boolean): LogLevel {
  if (/\b(ERROR|SEVERE|FATAL)\b/.test(line)) return "ERROR";
  if (/\bWARN(ING)?\b/.test(line)) return "WARN";
  if (/\bjoined the game\b/i.test(line)) return "JOIN";
  if (/\bleft the game\b/i.test(line)) return "LEFT";
  if (/<[^>]+>/.test(line)) return "CHAT";
  if (/^\s*\//.test(line)) return "CMD";
  return stderr ? "ERROR" : "INFO";
}

export const CONSOLE_LOG: LogLine[] = [
  { time: "14:22:04", level: "INFO", message: "Starting minecraft server version 1.21.4" },
  { time: "14:22:05", level: "INFO", message: "Loading properties · level-name=aurora, view-distance=10" },
  { time: "14:22:09", level: "INFO", message: "Preparing spawn area: 84%" },
  { time: "14:22:16", level: "INFO", message: 'Done (11.482s)! For help, type "help"' },
  { time: "14:23:58", level: "JOIN", message: "kestrelbay joined the game (22 online)" },
  { time: "14:24:31", level: "JOIN", message: "thornfield joined the game (23 online)" },
  { time: "14:24:47", level: "CHAT", message: "<thornfield> anyone got spare netherite" },
  { time: "14:25:02", level: "CMD", message: "/whitelist add lumen_verd" },
  { time: "14:25:03", level: "INFO", message: "Added lumen_verd to the whitelist" },
  { time: "14:25:44", level: "WARN", message: "Can't keep up! Running 2481ms behind — did the system time change?" },
  { time: "14:25:47", level: "ERROR", message: "Chunk file at [-12,41] is missing block state palette" },
  { time: "14:25:48", level: "WARN", message: "Region file r.-1.2.mca will be regenerated on next save" },
  { time: "14:26:03", level: "INFO", message: "Autosave complete · 1.2 GB written in 840ms" },
  { time: "14:26:19", level: "LEFT", message: "mirefen left the game (22 online)" },
  { time: "14:26:40", level: "INFO", message: "Watchdog: tick time back within budget (48.2ms)" },
];

export const COMMAND_SUGGESTIONS = ["/say", "/save-all", "/whitelist add", "/op", "/stop"];
