import { Plus } from "lucide-react";
import type { Role } from "@prisma/client";
import { scopeOf } from "@/domain/access/permissions";
import { AppShell, type ShellUser } from "./shell";
import { LinkButton } from "./ui";

/* What a per-server page shows when there is no server to show.

   These pages used to return nothing at all, so an empty workspace
   opened Console or Files onto a blank screen with no navigation —
   indistinguishable from the panel having crashed. */
export function NoServers({ user, section }: { user: ShellUser; section: string }) {
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
  return (
    <AppShell crumbs={[section]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em]">{section}</h1>
        <div className="flex flex-col items-start gap-3 rounded-[14px] border border-line bg-card p-6">
          <h2 className="text-[15px] font-semibold">No servers yet</h2>
          <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-3">
            {section} belongs to a server, and this workspace has none. Servers run on nodes — add a
            node if there is none, then create a server on it.
          </p>
          <div className="flex gap-2">
            <LinkButton href="/servers/new" icon={Plus}>
              Create server
            </LinkButton>
            <LinkButton href="/nodes" intent="secondary">
              Nodes
            </LinkButton>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
