import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";
import { scopeOf } from "@/domain/access/permissions";
import { AppShell, type ShellUser } from "./shell";
import { LinkButton } from "./ui";
import { nodesInServiceCount } from "@/lib/queries";

/* What a per-server page shows when there is no server to show.

   These pages used to return nothing at all, so an empty workspace
   opened Console or Files onto a blank screen with no navigation —
   indistinguishable from the panel having crashed. */
export async function NoServers({ user, section }: { user: ShellUser; section: string }) {
  /* A member is shown the servers that are theirs; none is a different
     sentence from none existing, and the buttons below are not theirs. */
  if (scopeOf(user.role as Role, "server.read") !== "all") {
    return (
      <AppShell crumbs={[section]} user={user}>
        <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">{section}</h1>
          <div className="flex flex-col items-start gap-3 rounded-[14px] border border-line bg-card p-6">
            <h2 className="text-[15px] font-semibold">No server is yours yet</h2>
            <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-3">
              {section} belongs to a server, and you see the servers that were given to you. An
              owner or an admin gives one from its Settings page.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }
  // With no node there is nothing to create a server on: the button that is first says what is first.
  const noNode = (await nodesInServiceCount()) === 0;
  return (
    <AppShell crumbs={[section]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em]">{section}</h1>
        <div className="flex flex-col items-start gap-3 rounded-[14px] border border-line bg-card p-6">
          <h2 className="text-[15px] font-semibold">No servers yet</h2>
          <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-3">
            {noNode
              ? `${section} belongs to a server, and a server runs on a node, and this workspace has neither. Add a node first, then create a server on it.`
              : `${section} belongs to a server, and this workspace has none. Create one on a node.`}
          </p>
          <div className="flex gap-2">
            {noNode ? (
              <LinkButton href="/nodes" icon={Plus}>
                Add a node
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/servers/new" icon={Plus}>
                  Create server
                </LinkButton>
                <LinkButton href="/nodes" intent="secondary">
                  Nodes
                </LinkButton>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
