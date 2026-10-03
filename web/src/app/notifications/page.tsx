import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { holds } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { notificationsView } from "@/lib/notify/channel-ops";
import { shellUser } from "@/lib/ui-types";
import { NotificationsPanel } from "./notifications-panel";

export const dynamic = "force-dynamic";

/* Where the panel tells people what went wrong. Owners' and admins', like
   the DNS provider and the bucket: a channel is an address somebody pasted,
   and the panel calls it from inside its own network. */
export default async function NotificationsPage() {
  const user = await requireUser();
  if (!holds(user.role, "notifications.manage")) {
    return <Refused user={shellUser(user)} section="Notifications" who="owners and admins" />;
  }
  const view = await notificationsView();

  return (
    <AppShell crumbs={["Notifications"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Notifications</h1>
          <p className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
            The panel can tell a Discord channel, or anything that takes a webhook, when a server crashes, a node goes
            quiet, a backup fails or an update is available. It reads what it already writes to the audit log: nothing
            about a server changes, and with no channel here nothing is sent.
          </p>
        </div>
        <NotificationsPanel view={view} />
      </div>
    </AppShell>
  );
}
