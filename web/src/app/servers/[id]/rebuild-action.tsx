"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hammer, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { rebuildServer } from "@/app/actions/updates";
import { InstallProgressDetail, newProgressKey, useInstallProgress } from "@/components/install-progress";

/* Rebuilding a server on the version it is already on.

   Two places ask for it. When the workload is gone — removed outside the
   panel, or destroyed by an update or a settings rebuild that then failed
   — the server page says so at the top, with the reason, because nothing
   else on it works until this happens. Otherwise it sits with the
   version, for the rarer case of a definition that changed what its
   workload is given. */

export function RebuildAction({
  slug,
  serverName,
  nodeName,
  versionLabel,
  missing,
  reason = null,
}: {
  slug: string;
  serverName: string;
  nodeName: string;
  versionLabel: string;
  /** The workload is gone from the node. */
  missing: boolean;
  /** Why it is gone, as recorded on the server. */
  reason?: string | null;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [running, start] = useTransition();
  // A build removed from the node is downloaded again first; the page watches it.
  const [progressKey, setProgressKey] = useState<string | null>(null);
  const progress = useInstallProgress(progressKey);

  const rebuild = () => {
    const key = newProgressKey();
    setProgressKey(key);
    start(async () => {
      setConfirming(false);
      const result = await rebuildServer(slug, key);
      setProgressKey(null);
      push(
        result.ok
          ? { tone: result.tone, title: result.title, body: result.body }
          : { tone: "danger", title: result.title, body: result.body },
      );
      router.refresh();
    });
  };

  const watching = running && (
    <div className="mt-2" role="status" aria-live="polite">
      <InstallProgressDetail progress={progress} waiting="Asking the node…" />
    </div>
  );

  const explanation = missing
    ? `A new workload is made on ${nodeName} from ${versionLabel}, around the files that are still there, and started. Nothing in the server's directory is changed.`
    : `${serverName} is stopped, its workload replaced by a new one from ${versionLabel} around the same files, and started again if it was running. The world is not touched, so no backup is taken. Players are disconnected.`;

  if (missing) {
    return (
      <div className="flex flex-col gap-3 rounded-[11px] border border-danger-line bg-danger-soft px-4 py-3 sm:flex-row sm:items-start">
        <TriangleAlert size={16} strokeWidth={1.9} className="mt-[1px] shrink-0 text-danger" />
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-danger">Nothing to start on {nodeName}.</strong>{" "}
          {reason ? `${sentence(reason)} ` : "Its workload is gone. "}
          The server&apos;s files — its world, its config, its backups — are still there.
          {confirming && <p className="mt-2 text-ink-3">{explanation}</p>}
          {watching}
        </div>
        <div className="flex shrink-0 gap-2">
          {confirming && (
            <Button intent="ghost" size="sm" disabled={running} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            icon={Hammer}
            disabled={running}
            onClick={() => (confirming ? rebuild() : setConfirming(true))}
          >
            {running ? "Rebuilding…" : confirming ? "Rebuild now" : "Rebuild"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-[14px] border-t border-line pt-[14px]">
      {confirming && (
        <p className="mb-3 rounded-[9px] border border-warning-line bg-warning-soft p-[12px] text-[11.5px] leading-relaxed text-ink-3">
          {explanation}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          intent="secondary"
          size="sm"
          icon={Hammer}
          disabled={running}
          onClick={() => (confirming ? rebuild() : setConfirming(true))}
        >
          {running ? "Rebuilding…" : confirming ? "Rebuild now" : "Rebuild on this version"}
        </Button>
        {confirming && (
          <Button intent="ghost" size="sm" disabled={running} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
      </div>
      {watching}
    </div>
  );
}

/* Recorded errors are written by whatever failed, some with a full stop
   and some without; the banner reads them as a sentence either way. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}
