import { Archive, GitBranch, RotateCw, Send, ShieldCheck, Trash2 } from "lucide-react";

/* A task's icon and colour, on the page and on the timeline's marks (a client component, which cannot be handed a component). */
export const KIND = {
  BACKUP: { icon: Archive, colour: "var(--accent)" },
  RESTART: { icon: RotateCw, colour: "var(--warning)" },
  BROADCAST: { icon: Send, colour: "var(--info)" },
  CLEANUP: { icon: Trash2, colour: "var(--ink-4)" },
  COMMAND: { icon: GitBranch, colour: "var(--accent-2)" },
  VERIFY: { icon: ShieldCheck, colour: "var(--success)" },
} as const;

export type Kind = keyof typeof KIND;
