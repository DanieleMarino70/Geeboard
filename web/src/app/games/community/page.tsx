import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { Card } from "@/components/ui";
import { holds } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { communityOverview } from "@/lib/community-games";
import { shellUser } from "@/lib/ui-types";
import { ProposeForm } from "./propose-form";
import { RegistriesForm } from "./registries-form";
import { StateBadge } from "./state-badge";

export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB");

/* Games somebody wrote. Owners and admins propose one; only an owner approves it, with a fresh code, after reading
   what it would run. The rules a manifest is held to are in docs/community-games.md. */
export default async function CommunityGamesPage() {
  const user = await requireUser();
  if (!holds(user.role, "community.propose")) {
    return <Refused user={shellUser(user)} crumbs={["Games", "Community"]} section="Community games" who="owners and admins" />;
  }
  const overview = await communityOverview();
  const canApprove = holds(user.role, "community.approve");
  const waiting = overview.revisions.filter((r) => r.state === "PENDING").length;

  return (
    <AppShell crumbs={[{ label: "Games", href: "/games" }, "Community"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Community games</h1>
          <p className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
            A game nobody at Geeboard wrote: a manifest that names a container image and says how the panel is to run it. It is
            only ever a definition — the panel never fetches one from the Internet, and nothing here runs until an owner has read
            what it would do and approved it. Even then it can be placed only on a node whose machine has agreed to community
            games. What an image can do on a node is plain on the page that asks for approval.
          </p>
        </div>

        <ProposeForm />

        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
            <h2 className="text-[14px] font-semibold">Revisions</h2>
            <span className="font-mono text-[10.5px] text-ink-4">
              {overview.revisions.length} · {waiting} waiting
            </span>
          </div>
          {overview.revisions.length === 0 ? (
            <div className="px-6 py-[40px] text-center">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                <Users size={20} strokeWidth={1.6} />
              </div>
              <div className="text-[13.5px] font-semibold">No community games yet</div>
              <p className="mx-auto mt-2 max-w-[52ch] text-xs leading-relaxed text-ink-4">Propose one above. It shows here, waiting, until an owner reads it.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {overview.revisions.map((r) => (
                <li key={r.id}>
                  <Link href={`/games/community/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-[14px] hover:bg-card-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-[10px]">
                        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">{r.name}</span>
                        <span className="font-mono text-[11px] text-ink-4">
                          {r.gameId} · revision {r.revision}
                        </span>
                        <StateBadge state={r.state} />
                      </div>
                      <div className="mt-[3px] text-[11px] text-ink-4">
                        Proposed{r.submittedBy ? ` by ${r.submittedBy}` : ""}, {when(r.submittedAt)}
                        {r.reviewedAt ? ` · decided${r.reviewedBy ? ` by ${r.reviewedBy}` : ""}, ${when(r.reviewedAt)}` : ""}
                        {r.note ? ` · “${r.note}”` : ""}
                      </div>
                    </div>
                    <span className="font-mono text-[10.5px] text-ink-4">{r.hash.slice(0, 12)}</span>
                    <ChevronRight size={14} strokeWidth={1.9} className="text-ink-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <RegistriesForm registries={overview.registries} defaults={overview.defaultRegistries} canEdit={canApprove} />
      </div>
    </AppShell>
  );
}
