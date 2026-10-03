import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { Notice } from "@/components/form";
import { holds } from "@/domain/access/permissions";
import { previewOf } from "@/domain/games/preview";
import { requireUser } from "@/lib/auth";
import { revisionDetail } from "@/lib/community-games";
import { shellUser } from "@/lib/ui-types";
import { StateBadge } from "../state-badge";
import { PreviewView, SayWhatItCanDo } from "./preview-view";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/* One revision, read the way an owner has to read it before saying yes: what it would run, not what it says about itself. */
export default async function RevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!holds(user.role, "community.propose")) {
    return <Refused user={shellUser(user)} crumbs={["Games", "Community"]} section="Community games" who="owners and admins" />;
  }
  const { id } = await params;
  const detail = await revisionDetail(id);
  if (!detail) notFound();
  const { revision: r, check, intact } = detail;

  return (
    <AppShell crumbs={[{ label: "Games", href: "/games" }, { label: "Community", href: "/games/community" }, `${r.name} r${r.revision}`]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">{r.name}</h1>
            <StateBadge state={r.state} />
          </div>
          <p className="mt-[7px] font-mono text-[11px] text-ink-4">
            {r.gameId} · revision {r.revision} · proposed{r.submittedBy ? ` by ${r.submittedBy}` : ""}, {when(r.submittedAt)}
            {r.reviewedAt ? ` · decided${r.reviewedBy ? ` by ${r.reviewedBy}` : ""}, ${when(r.reviewedAt)}` : ""}
          </p>
          <p className="mt-[5px] font-mono text-[11px] break-all text-ink-3" title="SHA-256 of the canonical manifest. Approval is tied to this.">
            sha256 {r.hash}
          </p>
          {r.note && <p className="mt-[5px] text-[12px] text-ink-3">“{r.note}”</p>}
          {detail.servers > 0 && (
            <p className="mt-[5px] text-[12px] text-ink-3">
              {detail.servers} server{detail.servers === 1 ? "" : "s"} here run{detail.servers === 1 ? "s" : ""} this game.
            </p>
          )}
        </div>

        {!intact && (
          <Notice tone="danger">
            What is stored for this revision no longer hashes to what was proposed. It will not load and cannot be approved. Propose it again.
          </Notice>
        )}

        {check.ok ? (
          <>
            <SayWhatItCanDo />
            <PreviewView preview={previewOf(check.definition)} />
          </>
        ) : (
          <Notice tone="danger">
            <div className="font-semibold">It does not pass the rules as they are now</div>
            <ul className="mt-[6px] flex flex-col gap-[4px]">
              {check.problems.slice(0, 20).map((p, i) => (
                <li key={i}>
                  <code className="font-mono text-[11px]">{p.path || "manifest"}</code> {p.message}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <ReviewPanel
          revisionId={r.id}
          gameId={r.gameId}
          gameName={r.name}
          hash={r.hash}
          state={r.state}
          canApprove={holds(user.role, "community.approve")}
          passes={check.ok && intact}
        />

        <details className="rounded-[14px] border border-line bg-card">
          <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium">The manifest as it was given</summary>
          <pre className="max-h-[480px] overflow-auto border-t border-line px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2">{detail.text}</pre>
        </details>
      </div>
    </AppShell>
  );
}
