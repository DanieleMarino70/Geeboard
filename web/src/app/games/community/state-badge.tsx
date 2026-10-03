import { Badge } from "@/components/ui";
import type { RevisionView } from "@/lib/community-games";

/* One word and one colour for each state a revision can be in, the same on the list and on the page that reads it. */

const STATE: Record<RevisionView["state"], { label: string; tone: "success" | "warning" | "danger" | "info" | "muted" }> = {
  PENDING: { label: "waiting", tone: "warning" },
  APPROVED: { label: "approved", tone: "success" },
  REJECTED: { label: "turned down", tone: "danger" },
  SUPERSEDED: { label: "replaced", tone: "muted" },
  RETIRED: { label: "retired", tone: "muted" },
};

export function StateBadge({ state }: { state: RevisionView["state"] }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>;
}
