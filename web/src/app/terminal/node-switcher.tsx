import Link from "next/link";
import clsx from "clsx";
import type { NodeTerminal } from "@/domain/nodes/terminal";

/* Which node the terminal page is showing, as links — the ServerSwitcher's
   shape, with one more fact per item: whether that node's machine allows
   a shell, said in a word beside the name rather than left to be found
   out after clicking. */

export type SwitcherNode = {
  name: string;
  state: string;
  approved: boolean;
  hasAgent: boolean;
  terminal: NodeTerminal | null;
};

export function availability(node: SwitcherNode): { word: string; tone: "on" | "off" | "warn" } {
  if (!node.approved) return { word: "pending", tone: "warn" };
  if (!node.hasAgent) return { word: "no agent", tone: "warn" };
  if (!node.terminal) return { word: "agent too old", tone: "warn" };
  if (node.terminal.state === "on") return { word: "on", tone: "on" };
  if (node.terminal.state === "off") return { word: "off", tone: "off" };
  return { word: "unavailable", tone: "warn" };
}

export function NodeSwitcher({ nodes, current }: { nodes: SwitcherNode[]; current: string }) {
  if (nodes.length <= 1) return null;
  return (
    <nav aria-label="Node" className="inline-flex max-w-full flex-wrap gap-px rounded-[9px] bg-(--border) p-px">
      {nodes.map((node) => {
        const on = node.name === current;
        const said = availability(node);
        return (
          <Link
            key={node.name}
            href={`/terminal?node=${encodeURIComponent(node.name)}`}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "flex items-center gap-[7px] rounded-lg px-3 py-[6px] text-[11.5px] whitespace-nowrap transition-colors duration-150",
              on ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            <span className="font-mono">{node.name}</span>
            <span
              className={clsx(
                "font-mono text-[9.5px] uppercase tracking-[0.06em]",
                said.tone === "on" ? "text-success" : said.tone === "off" ? "text-ink-4" : "text-warning",
              )}
            >
              {said.word}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
