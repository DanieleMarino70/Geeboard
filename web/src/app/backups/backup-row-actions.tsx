"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Lock, LockOpen, RotateCcw, Trash2 } from "lucide-react";
import { deleteBackup, restoreBackup, setBackupLock } from "@/app/actions/backups";
import { useToast } from "@/components/toast";

/* Restoring and deleting ask first. Both used to happen on one click of a
   small icon — and a restore replaces a server's whole world with the
   snapshot, so a slip of the mouse lost everything since it was taken.
   Locking is reversible and stays one click.

   The question renders as its own element beside the icons: the row lays
   out its children on a grid (and a wrapping flex line on a phone), and
   an element spanning every column lands on a line of its own under the
   row rather than squeezed into the narrow actions cell. */

export function BackupRowActions({
  id,
  name,
  serverName,
  locked,
  failed = false,
}: {
  id: string;
  name: string;
  serverName: string;
  locked: boolean;
  /** A failed backup has nothing to restore or keep — only to delete. */
  failed?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<"restore" | "delete" | null>(null);
  const { push } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<Awaited<ReturnType<typeof deleteBackup>>>) => {
    startTransition(async () => {
      const r = await fn();
      setAsking(null);
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });
  };

  const btn = "grid h-[26px] w-[26px] place-items-center rounded-[7px] transition-colors duration-150";

  return (
    <>
      <span className="ml-auto flex justify-end gap-1">
        <button
          type="button"
          aria-label={`Restore ${name}`}
          title={failed ? "A failed backup has nothing to restore" : "Restore this snapshot"}
          disabled={pending || failed}
          onClick={() => setAsking("restore")}
          className={clsx(
            btn,
            pending || failed
              ? "opacity-30"
              : asking === "restore"
                ? "bg-card-2 text-ink"
                : "text-ink-4 hover:bg-card-2 hover:text-ink",
          )}
        >
          <RotateCcw size={14} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
          title={failed ? "A failed backup has nothing to keep" : locked ? "Unlock — follow retention again" : "Lock — keep indefinitely"}
          disabled={pending || failed}
          onClick={() => run(() => setBackupLock(id, !locked))}
          className={clsx(
            btn,
            pending || failed ? "opacity-30" : locked ? "text-info hover:bg-card-2" : "text-ink-4 hover:bg-card-2 hover:text-ink",
          )}
        >
          {locked ? <Lock size={14} strokeWidth={1.7} /> : <LockOpen size={14} strokeWidth={1.7} />}
        </button>
        <button
          type="button"
          aria-label={`Delete ${name}`}
          title={locked ? "Locked snapshots cannot be deleted" : "Delete permanently"}
          disabled={pending || locked}
          onClick={() => setAsking("delete")}
          className={clsx(
            btn,
            pending || locked
              ? "opacity-30"
              : asking === "delete"
                ? "bg-danger-soft text-danger"
                : "text-ink-4 hover:bg-danger-soft hover:text-danger",
          )}
        >
          <Trash2 size={14} strokeWidth={1.7} />
        </button>
      </span>

      {asking && (
        <div
          role="alertdialog"
          aria-label={asking === "restore" ? `Restore ${name}` : `Delete ${name}`}
          style={{ gridColumn: "1 / -1" }}
          className="flex basis-full flex-col gap-3 rounded-[9px] border border-danger-line bg-danger-soft px-[14px] py-[11px] font-sans sm:flex-row sm:items-center"
        >
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-2">
            {asking === "restore" ? (
              <>
                <strong className="font-semibold text-danger">
                  Replace {serverName}&apos;s world with {name}?
                </strong>{" "}
                Everything since this snapshot was taken is lost. If the server is running it is
                stopped first and started again after.
              </>
            ) : (
              <>
                <strong className="font-semibold text-danger">Delete {name}?</strong> The archive is
                removed from the node. It cannot be restored afterwards.
              </>
            )}
          </p>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(null)}
              className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => (asking === "restore" ? restoreBackup(id) : deleteBackup(id)))}
              className="inline-flex items-center gap-[7px] rounded-lg border border-danger-line bg-card px-3 py-[6px] text-xs font-semibold text-danger transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
            >
              {asking === "restore" ? <RotateCcw size={13} strokeWidth={1.9} /> : <Trash2 size={13} strokeWidth={1.9} />}
              {pending
                ? asking === "restore"
                  ? "Restoring…"
                  : "Deleting…"
                : asking === "restore"
                  ? "Restore now"
                  : "Delete permanently"}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
