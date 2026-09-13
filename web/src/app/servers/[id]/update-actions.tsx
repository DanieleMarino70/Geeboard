"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { rollbackServer, updateServer } from "@/app/actions/updates";
import type { UpdateOffer } from "@/lib/update-ops";

/* The update and rollback buttons.

   Both take minutes and both are destructive in the sense that matters:
   an update stops the server and rebuilds it, a rollback replaces its
   world. So both confirm, and both say what will actually happen rather
   than asking "are you sure?" — a question nobody has ever answered
   thoughtfully. */

export function UpdateActions({
  slug,
  serverName,
  offer,
  canUpdate,
}: {
  slug: string;
  serverName: string;
  offer: UpdateOffer;
  canUpdate: boolean;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [running, start] = useTransition();
  const [confirming, setConfirming] = useState<"update" | "rollback" | null>(null);

  if (!canUpdate || (!offer.targetVersionId && !offer.rollback)) return null;

  const report = (r: { ok: boolean; title: string; body: string; tone?: "success" | "warning" }) =>
    push(
      r.ok
        ? { tone: r.tone ?? "success", title: r.title, body: r.body }
        : { tone: "danger", title: r.title, body: r.body },
    );

  const run = (work: () => Promise<{ ok: boolean; title: string; body: string; tone?: "success" | "warning" }>) => {
    setConfirming(null);
    start(async () => {
      report(await work());
      router.refresh();
    });
  };

  return (
    <div className="mt-[14px] border-t border-line pt-[14px]">
      {confirming === "update" && offer.targetVersionId && (
        <div className="mb-3 rounded-[9px] border border-warning-line bg-warning-soft p-[12px]">
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {serverName} will be backed up, stopped, rebuilt on{" "}
            <span className="font-mono">{offer.targetLabel}</span> and started again. The world is
            kept. Players are disconnected, and this can take several minutes.
          </p>
          <p className="mt-[7px] text-[11.5px] leading-relaxed text-ink-3">
            The backup is locked, so you can come back from it afterwards.
          </p>
        </div>
      )}

      {confirming === "rollback" && offer.rollback && (
        <div className="mb-3 rounded-[9px] border border-danger-line bg-danger-soft p-[12px]">
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {serverName} goes back to <span className="font-mono">{offer.rollback.label}</span> and
            its world is <strong>replaced</strong> with the backup taken before the update. Anything
            that happened since — blocks placed, players joined, settings changed in-game — is lost.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {offer.targetVersionId &&
          (confirming === "update" ? (
            <>
              <Button
                icon={ArrowUpCircle}
                disabled={running}
                onClick={() => run(() => updateServer(slug, offer.targetVersionId!))}
              >
                Update now
              </Button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="text-[11.5px] text-ink-3 hover:text-ink-2"
              >
                Cancel
              </button>
            </>
          ) : (
            <Button
              intent="secondary"
              icon={ArrowUpCircle}
              disabled={running}
              onClick={() => setConfirming("update")}
            >
              {running ? "Working…" : `Update to ${offer.targetLabel}`}
            </Button>
          ))}

        {offer.rollback &&
          (confirming === "rollback" ? (
            <>
              <Button
                intent="destructive"
                icon={Undo2}
                disabled={running}
                onClick={() => run(() => rollbackServer(slug))}
              >
                Roll back and replace the world
              </Button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="text-[11.5px] text-ink-3 hover:text-ink-2"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={running}
              onClick={() => setConfirming("rollback")}
              className="text-[11.5px] text-ink-3 hover:text-ink-2 disabled:opacity-50"
            >
              Roll back to {offer.rollback.label}
            </button>
          ))}
      </div>
    </div>
  );
}
