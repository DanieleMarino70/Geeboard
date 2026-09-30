import { ShieldCheck } from "lucide-react";
import { AppShell, type Crumb, type ShellUser } from "./shell";

/* What a page shows to a role that holds none of the permission it
   needs. The navigation does not list such a page for them, so this is
   reached by typing its address, or from a link written for somebody
   else; it says plainly whose page it is rather than drawing an empty
   one.

   Not for a permission the reader holds on some servers and not on the
   one asked for — those pages say so beside the server, as the console
   does. */
export function Refused({
  user,
  crumbs,
  section,
  who,
}: {
  user: ShellUser;
  crumbs?: Crumb[];
  section: string;
  /** Who the page is for, finishing "This page is for …". */
  who: string;
}) {
  return (
    <AppShell crumbs={crumbs ?? [section]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.025em]">{section}</h1>
        <div className="rounded-[14px] border border-line bg-card px-6 py-[52px] text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
            <ShieldCheck size={20} strokeWidth={1.6} />
          </div>
          <div className="text-[13.5px] font-semibold">Not yours to see</div>
          <p className="mx-auto mt-2 max-w-[52ch] text-xs leading-relaxed text-ink-4">
            This page is for {who}. Your account is a {user.role.toLowerCase()}; an owner or an admin
            can change that from Members.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
