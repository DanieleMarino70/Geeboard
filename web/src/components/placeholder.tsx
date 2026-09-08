import Link from "next/link";
import { AppShell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { Button } from "@/components/ui";

/* Routes that are designed but not built yet. The canvas has the
   finished layout for each of these — see design-canvas/. */
export async function Placeholder({
  crumbs,
  title,
  artboard,
  children,
}: {
  crumbs: string[];
  title: string;
  artboard: string;
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <AppShell crumbs={crumbs} user={user}>
      <div className="grid min-h-[70vh] place-items-center px-5 py-16 sm:px-8">
        <div className="max-w-[46ch] text-center">
          <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
            <span className="font-mono text-[10px]">WIP</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{children}</p>
          <p className="mt-4 font-mono text-[10.5px] text-ink-4">
            designed · {artboard}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href="/">
              <Button intent="secondary" size="sm">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
