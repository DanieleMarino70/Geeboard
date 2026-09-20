import { SearchX } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";

/* What a missing server, node or page shows.

   Next's default was a black page reading "404 | This page could not be
   found", outside the panel, with no way back but the browser's own
   button. A deleted server's old link is the ordinary way to land here,
   so this says so and keeps the navigation. */
export default async function NotFound() {
  const user = await getCurrentUser();

  const body = (
    <div className="grid min-h-[70vh] place-items-center px-5 py-16 sm:px-8">
      <div className="max-w-[44ch] text-center">
        <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
          <SearchX size={18} strokeWidth={1.7} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Nothing here</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          This page does not exist. If it was a server or a node, it may have been deleted or
          removed — the activity log records when.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href="/" size="sm">
            Dashboard
          </LinkButton>
          {user && (
            <LinkButton href="/activity" intent="secondary" size="sm">
              Activity
            </LinkButton>
          )}
        </div>
      </div>
    </div>
  );

  // Signed out, there is no navigation to keep — and no reason to show it.
  if (!user) return <main className="min-h-screen bg-bg text-ink">{body}</main>;
  return (
    <AppShell crumbs={["Not found"]} user={shellUser(user)}>
      {body}
    </AppShell>
  );
}
