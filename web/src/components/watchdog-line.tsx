import clsx from "clsx";
import { readWatchdog } from "@/lib/watchdog";

/* "Watchdog: last pass 6 s ago." — and, past three of the poller's intervals, a warning that says what that means and the command that
   shows why. The poller is the process that watches every server, restarts what crashed and runs the schedule; when it is dead
   nothing it would have said reaches anybody, so the pages say it for it. See domain/watchdog.ts.

   Says nothing when it cannot tell (a database that this release's migration has not reached yet): a missing line is better than a page
   that is not there. */
export async function WatchdogLine({ variant = "strip", className }: { variant?: "strip" | "block"; className?: string }) {
  const view = await readWatchdog();
  if (!view) return null;
  const late = view.state === "late";

  if (late && variant === "block") {
    return (
      <div
        data-watchdog="late"
        role="status"
        className={clsx("rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px] text-xs leading-snug text-warning", className)}
      >
        {view.line}
        {view.fix && (
          <>
            {" "}
            <code className="font-mono text-[11px]">{view.fix}</code>
          </>
        )}
      </div>
    );
  }

  return (
    <span data-watchdog={view.state} role={late ? "status" : undefined} className={clsx("font-mono text-[10.5px]", late ? "text-warning" : "text-ink-4", className)}>
      {view.line}
    </span>
  );
}
