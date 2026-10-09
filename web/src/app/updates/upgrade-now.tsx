"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { requestPanelUpdate } from "@/app/actions/panel-updates";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";
import { Button, Pill } from "@/components/ui";

type LastState = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "REFUSED" | "STUCK";

export interface UpgradeView {
  offer: { version: string } | null;
  why: string | null;
  updaterAlive: boolean;
  last: { version: string; fromVersion: string; state: LastState; requestedBy: string; requestedAt: string; finishedAt: string | null; log: string | null } | null;
  running: string;
}

const WORD: Record<LastState, [string, "info" | "warning" | "success" | "danger" | "muted"]> = {
  PENDING: ["Waiting for the machine", "info"],
  RUNNING: ["Upgrading", "warning"],
  DONE: ["Upgraded", "success"],
  FAILED: ["Upgrade failed", "danger"],
  REFUSED: ["Refused by the machine", "danger"],
  STUCK: ["No word from the machine", "danger"],
};

/* The Updates page's upgrade button, and what became of the last press. While an upgrade is waiting or running the page asks the
   panel every five seconds whether it is back, and redraws when it is: in between the panel is stopped, and that is the upgrade. */
export function UpgradeNow({ view, isOwner }: { view: UpgradeView; isOwner: boolean }) {
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState("");
  const [down, setDown] = useState(false);
  const [pending, start] = useAction();
  const { push } = useToast();
  const router = useRouter();
  const inFlight = view.last?.state === "PENDING" || view.last?.state === "RUNNING";

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        setDown(!r.ok);
        if (r.ok) router.refresh();
      } catch {
        setDown(true);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  const submit = () =>
    start(async () => {
      if (!view.offer) return;
      const r = await requestPanelUpdate(view.offer.version, code);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) {
        setAsking(false);
        setCode("");
        router.refresh();
      }
    });

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {view.offer && isOwner ? (
          <Button icon={ArrowUpCircle} onClick={() => setAsking(true)}>
            Upgrade to {view.offer.version}
          </Button>
        ) : (
          <Button icon={ArrowUpCircle} disabled title={view.why ?? "Only an owner can upgrade the panel"}>
            {view.offer ? `Upgrade to ${view.offer.version}` : "Upgrade"}
          </Button>
        )}
        <span className="text-[12px] leading-snug text-ink-3">
          {view.offer && !isOwner ? "Only an owner can upgrade the panel." : view.why ?? "A dump of the database is taken first, and the way back is printed when it ends."}
        </span>
      </div>

      {view.last && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-bg-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Pill tone={WORD[view.last.state][1]} pulse={inFlight}>
              {WORD[view.last.state][0]}
            </Pill>
            <span className="font-mono text-ink-3">
              {view.last.fromVersion} → {view.last.version}
            </span>
            <span className="text-ink-4">
              asked by {view.last.requestedBy}, {new Date(view.last.requestedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </span>
            {inFlight && (
              <span className="flex items-center gap-1 text-ink-3">
                <Loader2 size={12} className="animate-spin" />
                {down ? "The panel is restarting…" : view.last.state === "PENDING" ? "The machine picks it up within a minute." : "The installer is running."}
              </span>
            )}
          </div>
          {view.last.state === "STUCK" && (
            <p className="text-[12px] leading-snug text-ink-3">
              The machine started this more than an hour ago and has not written back. On the machine, the log is in /var/log/geeboard/ and{" "}
              <span className="font-mono">systemctl status geeboard-self-update</span> says what the updater is doing.
            </p>
          )}
          {view.last.log && !inFlight && (
            <pre className="max-h-[280px] overflow-auto rounded-[8px] border border-line bg-bg p-3 font-mono text-[10.5px] whitespace-pre-wrap text-ink-3">
              {view.last.log}
            </pre>
          )}
        </div>
      )}

      <Dialog open={asking} onClose={() => setAsking(false)} title={`Upgrade this panel to ${view.offer?.version ?? ""}?`} width={520}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ul className="flex list-disc flex-col gap-[6px] pl-5 text-[12.5px] leading-snug text-ink-2">
            <li>The machine picks the request up within a minute and runs the installer for {view.offer?.version}, as you would by hand.</li>
            <li>The panel and the poller stop for a few minutes: a dump of the database is taken, the migrations run, the new release starts.</li>
            <li>Game servers keep running. If a server is in the middle of an update, a backup or a restore, the installer stops and changes nothing.</li>
            <li>When it ends, the end of what the installer printed is shown here, with the commands that go back.</li>
          </ul>
          <label className="flex flex-col gap-[6px] text-[12px]">
            <span className="text-ink-2">A fresh code from your authenticator</span>
            <input
              data-autofocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              className="w-[140px] rounded-[9px] border border-control bg-bg-2 px-3 py-[9px] font-mono text-[14px] tracking-[0.2em] focus:border-accent-line"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" intent="ghost" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || code.length !== 6}>
              Upgrade to {view.offer?.version}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
