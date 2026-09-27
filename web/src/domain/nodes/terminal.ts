/* What a machine says about its node terminal, kept as it said it — but
   only in the shape the agent speaks (daemon/src/terminal.ts,
   TerminalDescriptor), and only text a page can show. Anything else is
   text a machine sent us, and is not stored. */

export interface NodeTerminal {
  state: "on" | "off" | "unavailable";
  reason?: string;
  /** The host's operating system — the machine's, not the engine's. */
  os: string;
  user: string;
  shell: string;
  scope: "machine" | "container";
}

const TERMINAL_TEXT = /^[\x20-\x7e -￿]{1,200}$/;

export function cleanTerminal(raw: unknown): NodeTerminal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string) =>
    typeof value[key] === "string" && TERMINAL_TEXT.test(value[key] as string) ? (value[key] as string) : null;
  const state = value.state;
  if (state !== "on" && state !== "off" && state !== "unavailable") return null;
  const os = text("os");
  const user = text("user");
  const shell = text("shell");
  const scope = value.scope === "container" ? "container" : value.scope === "machine" ? "machine" : null;
  if (!os || !user || !shell || !scope) return null;
  const reason = text("reason");
  return { state, ...(reason ? { reason } : {}), os, user, shell, scope };
}
