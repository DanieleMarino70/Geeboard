import { Construction } from "lucide-react";
import { AppShell, type Crumb } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { LinkButton } from "@/components/ui";

/* A route for a feature the platform does not have yet.

   It used to say "WIP" and name the design file the page was drawn in,
   which told somebody using the panel nothing they could act on. What it
   says now is what is missing, in the product's own terms, and where to
   go instead. These routes are not in the navigation; this is what a
   bookmark or an old link finds. */
export async function Unavailable({
  crumbs,
  title,
  children,
  instead,
}: {
  crumbs: Crumb[];
  title: string;
  /** Why it is not available, in a sentence or two. */
  children: React.ReactNode;
  /** Somewhere useful to go. */
  instead?: { label: string; href: string };
}) {
  const user = await requireUser();
  return (
    <AppShell crumbs={crumbs} user={user}>
      <div className="grid min-h-[70vh] place-items-center px-5 py-16 sm:px-8">
        <div className="max-w-[48ch] text-center">
          <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
            <Construction size={18} strokeWidth={1.7} />
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h1>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-4">
            not available yet
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{children}</p>
          <div className="mt-6 flex justify-center gap-2">
            {instead && (
              <LinkButton href={instead.href} size="sm">
                {instead.label}
              </LinkButton>
            )}
            <LinkButton href="/" intent="secondary" size="sm">
              Dashboard
            </LinkButton>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
