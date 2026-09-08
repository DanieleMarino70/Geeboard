"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Lock, LockOpen, RotateCcw, Trash2 } from "lucide-react";
import { deleteBackup, restoreBackup, setBackupLock } from "@/app/actions/backups";
import { useToast } from "@/components/toast";

export function BackupRowActions({
  id,
  name,
  locked,
}: {
  id: string;
  name: string;
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<Awaited<ReturnType<typeof deleteBackup>>>) => {
    startTransition(async () => {
      const r = await fn();
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
    <span className="flex justify-end gap-1">
      <button
        type="button"
        aria-label={`Restore ${name}`}
        title="Restore this snapshot"
        disabled={pending}
        onClick={() => run(() => restoreBackup(id))}
        className={clsx(btn, pending ? "opacity-40" : "text-ink-4 hover:bg-card-2 hover:text-ink")}
      >
        <RotateCcw size={14} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        aria-label={locked ? `Unlock ${name}` : `Lock ${name}`}
        title={locked ? "Unlock — follow retention again" : "Lock — keep indefinitely"}
        disabled={pending}
        onClick={() => run(() => setBackupLock(id, !locked))}
        className={clsx(
          btn,
          pending ? "opacity-40" : locked ? "text-info hover:bg-card-2" : "text-ink-4 hover:bg-card-2 hover:text-ink",
        )}
      >
        {locked ? <Lock size={14} strokeWidth={1.7} /> : <LockOpen size={14} strokeWidth={1.7} />}
      </button>
      <button
        type="button"
        aria-label={`Delete ${name}`}
        title={locked ? "Locked snapshots cannot be deleted" : "Delete permanently"}
        disabled={pending || locked}
        onClick={() => run(() => deleteBackup(id))}
        className={clsx(
          btn,
          pending || locked ? "opacity-30" : "text-ink-4 hover:bg-danger-soft hover:text-danger",
        )}
      >
        <Trash2 size={14} strokeWidth={1.7} />
      </button>
    </span>
  );
}
