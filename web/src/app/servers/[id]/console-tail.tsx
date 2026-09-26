import Link from "next/link";
import { Terminal } from "lucide-react";
import { asPlatformError } from "@/domain/errors";
import { findGame } from "@/domain/games/registry";
import { redactSecrets } from "@/domain/games/types";
import { runtimeFor } from "@/domain/runtime/docker";
import { LOG_COLOUR, classifyServerLine, type LogLevel } from "@/lib/console-fixture";
import { collapseProgress, isProbeLine } from "@/lib/console-lines";

/* The last few lines the server actually printed.

   This card used to render the console fixture for every server — a
   Minecraft boot log with a "live" dot, on a Terraria server, on a node
   with no agent. Now it shows what the node says, or says plainly why
   there is nothing to show. It is a snapshot taken when the page was
   drawn, so it does not claim to be live; the console page streams. */

const TAIL = 6;
/* A page render must not wait on a node that has wandered off. The
   agent client's own timeout is sized for operations, not for a card. */
const RENDER_BUDGET_MS = 2_500;

interface TailProps {
  slug: string;
  server: { id: string; runtimeId: string | null; gameId: string | null };
  node: { name: string; state: string; daemonUrl: string | null; daemonToken: string | null };
  /** `server.console.read` on this server, asked by the page. */
  allowed: boolean;
}

type Tail =
  | { kind: "lines"; lines: Array<{ level: LogLevel; message: string; probe: boolean }> }
  | { kind: "empty" | "no-agent" | "no-workload" | "not-allowed" }
  | { kind: "error"; message: string };

async function readTail({ server, node, allowed }: TailProps): Promise<Tail> {
  /* Before the node is asked anything. Every server's page is open to a
     member, and this card showed its last lines to all of them: six lines
     of somebody else's console, on a page the permission matrix says they
     may read, from a console it says they may not. */
  if (!allowed) return { kind: "not-allowed" };
  const runtime = runtimeFor(node);
  if (!runtime) return { kind: "no-agent" };
  if (!server.runtimeId) return { kind: "no-workload" };
  if (node.state === "UNREACHABLE") {
    return { kind: "error", message: `${node.name} is unreachable.` };
  }

  try {
    /* As many as the console page reads: blank lines are left out and a
       run of progress lines is folded, so asking for six used to show
       five, and a hundred and twenty lines of a Terraria boot folded to
       two. */
    const lines = await Promise.race([
      runtime.logs({ serverId: server.id, runtimeId: server.runtimeId }, 1000),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${node.name} did not answer in time.`)), RENDER_BUDGET_MS),
      ),
    ]);
    const game = server.gameId ? findGame(server.gameId) : undefined;
    // A line of only whitespace on stderr would otherwise be an empty ERROR row.
    const printed = collapseProgress(
      lines
        .filter((l) => l.line.trim().length > 0)
        .map((l) => ({ time: "", level: classifyServerLine(l.line, l.stderr), message: redactSecrets(game, l.line) })),
    );
    if (printed.length === 0) return { kind: "empty" };
    return {
      kind: "lines",
      lines: printed.slice(-TAIL).map((l) => ({
        level: l.level,
        message: l.message,
        probe: isProbeLine(game?.console.healthLines, l.message),
      })),
    };
  } catch (error) {
    return { kind: "error", message: asPlatformError(error).message };
  }
}

export async function ConsoleTail(props: TailProps) {
  const tail = await readTail(props);

  const notice =
    tail.kind === "not-allowed"
      ? "Its console is open to the server's owner, to moderators and to admins."
      : tail.kind === "no-agent"
      ? `${props.node.name} has no agent attached, so this server is simulated and has no output.`
      : tail.kind === "no-workload"
        ? "Nothing is running for this server on its node yet, so there is no output."
        : tail.kind === "empty"
          ? "The server has not printed anything yet."
          : tail.kind === "error"
            ? `Could not read the output: ${tail.message}`
            : null;

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-con-bg">
      <div className="flex items-center gap-[9px] border-b border-line bg-bg-2 px-4 py-[10px]">
        <Terminal size={14} strokeWidth={1.7} className="text-ink-4" />
        <span className="font-mono text-[10.5px] text-ink-3">
          console · last {tail.kind === "lines" ? tail.lines.length : TAIL} lines
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-ink-4">
          {tail.kind === "lines" ? "when this page loaded" : ""}
        </span>
        {tail.kind !== "not-allowed" && (
          <Link href={`/console?server=${props.slug}`} className="text-[11px] text-accent hover:underline">
            Open console
          </Link>
        )}
      </div>
      <div className="px-4 py-3 font-mono text-[11px] leading-[1.85]">
        {tail.kind === "lines" ? (
          tail.lines.map((l, i) => {
            const c = LOG_COLOUR[l.level];
            return (
              <div key={i} className={`flex gap-3 ${l.probe ? "opacity-55" : ""}`}>
                <span className={`w-[46px] shrink-0 text-[10.5px] tracking-[0.04em] ${c.level}`}>
                  {l.level}
                </span>
                <span className={`min-w-0 truncate ${c.message}`}>
                  {l.message}
                  {l.probe && <span className="ml-2 font-sans text-[9.5px] text-con-dim">Geeboard health check</span>}
                </span>
              </div>
            );
          })
        ) : (
          <p className={tail.kind === "error" ? "text-danger" : "text-con-dim"}>{notice}</p>
        )}
      </div>
    </div>
  );
}
