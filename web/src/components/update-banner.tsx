import Link from "next/link";
import { CircleArrowUp, ShieldAlert } from "lucide-react";
import { holds } from "@/domain/access/permissions";
import { STATE_WORD, toneOf } from "@/domain/updates/release";
import { agentsToUpgrade, readUpdateStatus, wantsAttention } from "@/lib/panel-update-ops";
import { LocalTime } from "./local-time";
import { Pill } from "./ui";

/* A line on the Dashboard when this panel is behind a release, or a node's agent is below a floor the release names — and nothing at all when
   it is not, which is nearly always. Read from the row the poller keeps: a page never asks GitHub. Only for who may act on it: owners and
   admins. The colour is the release's own word for it (a security update is red, a recommended one yellow, an ordinary one blue), and the
   words are always there, so no state is colour alone. */
export async function UpdateBanner({ role }: { role: string }) {
  if (!holds(role as Parameters<typeof holds>[0], "node.manage")) return null;
  const status = await readUpdateStatus();
  const attention = wantsAttention(status);
  if (!attention || !status.release || !status.panel) return null;

  const agents = agentsToUpgrade(status);
  const panelBehind = status.panel.state === "update" || status.panel.state === "recommended" || status.panel.state === "security";
  const state = status.panel.state === "security" || agents.some((a) => a.verdict.state === "security") ? "security" : status.panel.state === "recommended" ? "recommended" : panelBehind ? "update" : "unsupported";
  const Icon = state === "security" ? ShieldAlert : CircleArrowUp;
  const border = attention === "danger" ? "border-danger-line bg-danger-soft" : attention === "warning" ? "border-warning-line bg-warning-soft" : "border-info-line bg-info-soft";

  return (
    <section aria-label="A newer Geeboard" className={`relative flex flex-wrap items-start gap-x-4 gap-y-2 rounded-[12px] border px-4 py-3 ${border}`}>
      <Icon size={18} strokeWidth={1.8} className="mt-[1px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          <Pill tone={toneOf(state)}>{STATE_WORD[state]}</Pill>
          <span>
            {panelBehind ? `Geeboard ${status.release.version} is out` : "A node's agent is behind"}
            <span className="font-normal text-ink-3"> · this panel is {status.installed}</span>
          </span>
        </div>
        <p className="mt-[6px] max-w-[80ch] text-[12.5px] leading-snug text-ink-2">
          {panelBehind ? status.panel.says : null}
          {panelBehind && agents.length > 0 ? " " : null}
          {agents.length > 0
            ? `${agents.map((a) => `${a.node} (agent ${a.version})`).join(", ")} ${agents.length === 1 ? "is" : "are"} below ${agents.some((a) => a.verdict.state === "security") ? "the security floor" : "the minimum"} the release names: upgrade ${agents.length === 1 ? "it" : "them"} on ${agents.length === 1 ? "its machine" : "their machines"}.`
            : null}
          {status.release.summary ? ` ${status.release.summary}` : null}
        </p>
        <p className="mt-[6px] text-[11.5px] text-ink-3">
          Checked <LocalTime at={status.succeededAt ?? status.checkedAt} style="datetime" /> ·{" "}
          <Link href="/updates" className="text-accent-fg underline-offset-2 hover:underline">
            What to do, and what is below the minimum
          </Link>
        </p>
      </div>
    </section>
  );
}
