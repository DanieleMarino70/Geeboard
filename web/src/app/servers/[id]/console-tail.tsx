import Link from "next/link";
import { Terminal } from "lucide-react";
import { asPlatformError } from "@/domain/errors";
import { runtimeFor } from "@/domain/runtime/docker";
import { LOG_COLOUR, classifyServerLine, type LogLevel } from "@/lib/console-fixture";

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
  server: { id: string; runtimeId: string | null };
  node: { name: string; state: string; daemonUrl: string | null; daemonToken: string | null };
}

type Tail =
  | { kind: "lines"; lines: Array<{ level: LogLevel; message: string }> }
  | { kind: "empty" | "no-agent" | "no-workload" }
  | { kind: "error"; message: string };

async function readTail({ server, node }: TailProps): Promise<Tail> {
  const runtime = runtimeFor(node);
  if (!runtime) return { kind: "no-agent" };
  if (!server.runtimeId) return { kind: "no-workload" };
  if (node.state === "UNREACHABLE") {
    return { kind: "error", message: `${node.name} is unreachable.` };
  }

  try {
    const lines = await Promise.race([
      runtime.logs({ serverId: server.id, runtimeId: server.runtimeId }, TAIL),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${node.name} did not answer in time.`)), RENDER_BUDGET_MS),
      ),
    ]);
    // A line of only whitespace on stderr would otherwise be an empty ERROR row.
    const printed = lines.filter((l) => l.line.trim().length > 0);
    if (printed.length === 0) return { kind: "empty" };
    return {
      kind: "lines",
      lines: printed.slice(-TAIL).map((l) => ({ level: classifyServerLine(l.line, l.stderr), message: l.line })),
    };
  } catch (error) {
    return { kind: "error", message: asPlatformError(error).message };
  }
}

export async function ConsoleTail(props: TailProps) {
  const tail = await readTail(props);

  const notice =
    tail.kind === "no-agent"
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
          console · last {TAIL} lines
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-ink-4">
          {tail.kind === "lines" ? "when this page loaded" : ""}
        </span>
        <Link href={`/console?server=${props.slug}`} className="text-[11px] text-accent hover:underline">
          Open console
        </Link>
      </div>
      <div className="px-4 py-3 font-mono text-[11px] leading-[1.85]">
        {tail.kind === "lines" ? (
          tail.lines.map((l, i) => {
            const c = LOG_COLOUR[l.level];
            return (
              <div key={i} className="flex gap-3">
                <span className={`w-[46px] shrink-0 text-[10.5px] tracking-[0.04em] ${c.level}`}>
                  {l.level}
                </span>
                <span className={`min-w-0 truncate ${c.message}`}>{l.message}</span>
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
