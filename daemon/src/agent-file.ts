import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/* What an agent remembers about the panel it joined.

   The agent used to read the environment and nothing else, so the
   command that registered a machine also had to be the command that
   started it every time after — agent token included, which the Add a
   node dialog could show only once. Lose the command and the machine
   had to be registered again.

   Now `npm run join` writes what it learned here, and `npm start` reads
   it. The environment still wins over the file, value by value, so a
   machine configured the old way — or a test — is unaffected.

   The file holds the agent token, which controls every container on the
   machine. It lives in the account's own profile rather than beside the
   code, and on Unix it is readable by its owner alone. */

export interface AgentFile {
  panelUrl: string;
  nodeName: string;
  /** The secret the panel presents on every request. */
  token: string;
  /** The token before a rotation the panel has not confirmed yet; still accepted. See rotate.ts. */
  previousToken?: string;
  advertiseUrl: string;
  port: number;
  dataRoot: string;
  /** Declared, not measured — see capabilities.ts. */
  capabilities: string[];
  joinedAt: string;
}

/* Where the file is, for this account on this machine.

   Per account rather than machine-wide: on Windows ProgramData is
   readable by every local user, and an agent token there would be
   readable by all of them. Root on Unix is the machine's own account,
   so /etc is its profile. */
export function agentFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  uid: number | null = typeof process.getuid === "function" ? process.getuid() : null,
): string {
  if (env.GEEBOARD_AGENT_FILE) return env.GEEBOARD_AGENT_FILE;
  if (platform === "win32") {
    return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local"), "Geeboard", "agent.json");
  }
  if (uid === 0) return "/etc/geeboard/agent.json";
  return path.posix.join(env.XDG_CONFIG_HOME ?? path.posix.join(home, ".config"), "geeboard", "agent.json");
}

/** The file, or null when this machine has not joined a panel. */
export function readAgentFile(file: string): AgentFile | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  let parsed: Partial<AgentFile>;
  try {
    parsed = JSON.parse(raw) as Partial<AgentFile>;
  } catch {
    throw new Error(`${file} is not valid JSON. Run npm run join again, or remove it.`);
  }

  /* A half-written or hand-edited file is refused whole rather than
     filled in with defaults: an agent that started with the wrong name
     or token would heartbeat into a refusal and look like a panel fault. */
  const text = (key: keyof AgentFile) => typeof parsed[key] === "string" && (parsed[key] as string).length > 0;
  if (!text("panelUrl") || !text("nodeName") || !text("token") || !text("advertiseUrl") || !text("dataRoot")) {
    throw new Error(`${file} is incomplete. Run npm run join again with a new token from the panel.`);
  }

  return {
    panelUrl: parsed.panelUrl!,
    nodeName: parsed.nodeName!,
    token: parsed.token!,
    ...(typeof parsed.previousToken === "string" && parsed.previousToken.length >= 32
      ? { previousToken: parsed.previousToken }
      : {}),
    advertiseUrl: parsed.advertiseUrl!,
    port: Number.isInteger(parsed.port) ? parsed.port! : 8080,
    dataRoot: parsed.dataRoot!,
    capabilities: Array.isArray(parsed.capabilities)
      ? parsed.capabilities.filter((c): c is string => typeof c === "string")
      : [],
    joinedAt: typeof parsed.joinedAt === "string" ? parsed.joinedAt : "",
  };
}

/* Written whole or not at all: to a temporary file beside it, then
   renamed over, so a crash mid-write leaves the previous file rather
   than half of a new one. Modes are ignored on Windows, where the
   profile directory is already the account's own. */
export function writeAgentFile(file: string, contents: AgentFile): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
