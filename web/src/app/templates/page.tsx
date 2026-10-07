import { AppShell } from "@/components/shell";
import { Refused } from "@/components/refused";
import { holds } from "@/domain/access/permissions";
import { requireUser } from "@/lib/auth";
import { shellUser } from "@/lib/ui-types";
import { templatesView } from "@/lib/template-ops";
import { TemplateList } from "./template-list";

export const dynamic = "force-dynamic";

/* The workspace's own starting points for new servers: what somebody chose to keep of
   a server that exists. Owners' and admins', like creating a server. */
export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const user = await requireUser();
  if (!holds(user.role, "template.manage")) {
    return <Refused user={shellUser(user)} section="Templates" who="owners and admins" />;
  }
  const templates = await templatesView();

  return (
    <AppShell crumbs={["Templates"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Templates</h1>
          <p className="mt-[7px] max-w-[74ch] text-[12.5px] leading-snug text-ink-3">
            A template is a way to start: the settings, the limits and the version of a server you set up well, kept so
            the next one begins there. Save one from a server&apos;s Settings page. It does not keep the world, the
            players, the address or the schedule, and not a join password; a server made from it asks for its own.
          </p>
        </div>
        <TemplateList templates={templates} />
      </div>
    </AppShell>
  );
}
