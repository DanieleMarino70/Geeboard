import process from "node:process";
import { logger } from "./log.ts";

/* How the agent ends when it must, so that whatever supervises it can tell
   the endings apart.

   EXIT_CONFIG is "this will fail the same way next time": the port is taken,
   or the address is not this machine's. The systemd unit lists it in
   RestartPreventExitStatus, because restarting every five seconds is a loop
   that fixes nothing and fills a journal. Everything else is EXIT_FATAL,
   which a supervisor should restart. */
export const EXIT_FATAL = 70;
export const EXIT_CONFIG = 78;

function describe(reason: unknown): { detail: string; stack?: string } {
  if (reason instanceof Error) return { detail: reason.message, stack: reason.stack };
  return { detail: typeof reason === "string" ? reason : JSON.stringify(reason) ?? String(reason) };
}

/* An error nobody handled. Node's own answer is a stack trace over several
   lines and an exit; this is the same exit with one structured line first,
   so the journal says what the agent died of in the form it says everything
   else in. The agent holds nothing a half-finished request could corrupt —
   containers and files are the engine's and the disk's — so ending and being
   restarted is safer than carrying on in a state nobody has looked at. */
export function installCrashHandlers(
  proc: { on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown },
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let ending = false;
  const end = (kind: string, reason: unknown) => {
    if (ending) return;
    ending = true;
    try {
      logger.error("the agent hit an error it cannot recover from and is exiting", { kind, ...describe(reason) });
    } finally {
      exit(EXIT_FATAL);
    }
  };
  proc.on("uncaughtException", (error) => end("uncaughtException", error));
  proc.on("unhandledRejection", (reason) => end("unhandledRejection", reason));
}
