import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { nodeCapacities, workspaceDomain } from "@/lib/create-ops";
import { dnsZone } from "@/lib/dns-ops";
import { allGames, isCommunityId } from "@/domain/games/registry";
import { cloneStart, templateStart } from "@/lib/template-ops";
import { CreateWizard } from "./wizard";

export const dynamic = "force-dynamic";

/* The wizard is the one screen that does not wear the app shell: it is
   a task with a beginning and an end, and the sidebar would offer a way
   out of it on every row. The design says the same — a bare header with
   one way to cancel. */
export default async function NewServerPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string; template?: string; clone?: string }>;
}) {
  const user = await requireUser();

  /* Placement commits a node's resources, so it sits with the roles
     that can drain a node. Saying so here beats letting someone fill in
     five steps and be refused at the end. */
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-[420px] text-center">
          <span className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-[11px] bg-warning-soft text-warning">
            <ShieldAlert size={18} strokeWidth={1.8} />
          </span>
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">
            Creating servers needs admin
          </h1>
          <p className="mt-[10px] text-[13px] leading-relaxed text-ink-3">
            A new server commits a node&rsquo;s memory, CPU and a port for as long as it exists, so
            only owners and admins can place one. Ask one of them, and it will be yours to run.
          </p>
          <Link
            href="/servers"
            className="mt-5 inline-block text-[12.5px] text-accent hover:underline"
          >
            Back to servers
          </Link>
        </div>
      </div>
    );
  }

  const [nodes, domain, zone, params] = await Promise.all([
    nodeCapacities(),
    workspaceDomain(),
    dnsZone(),
    searchParams,
  ]);

  /* A saved template or a server to clone opens the wizard filled in. One that
     does not resolve — deleted since the link was made, a game no longer
     offered — is the plain wizard, which is what somebody expects of a stale link. */
  const from = params.template
    ? await templateStart(user, params.template)
    : params.clone
      ? await cloneStart(user, params.clone)
      : null;

  return (
    <CreateWizard
      nodes={nodes}
      domain={domain}
      dnsZone={zone}
      startGameId={params.game}
      from={from}
      communityGames={allGames().filter((g) => isCommunityId(g.id))}
    />
  );
}
