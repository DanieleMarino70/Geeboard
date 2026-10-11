"use client";

import { useState } from "react";
import { RotateCw, TriangleAlert, Trash2 } from "lucide-react";
import { deleteServer } from "@/app/actions/settings";
import { inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { useAction } from "@/components/use-action";

export interface Deletion {
  localBackups: number;
  offsiteBackups: number;
  /** Null when a last off-site backup can be taken; otherwise why not. */
  finalBackupBlocked: string | null;
  /** The panel has not reached the node for longer than it takes to be called unreachable: the option to forget the server is drawn. */
  nodeGone: boolean;
}

/* Deleting is called rather than submitted.

   It sat inside the settings form once, and a form cannot be nested in
   another, so it reached a hidden sibling form through the `form`
   attribute. React does not run a form action for a submitter attached
   that way — the browser submits natively, React warns that a form was
   unexpectedly submitted, and the server action never runs. It looked
   like nothing happened, because nothing did. It is the last section of
   the page now, after everything the save bar saves, and none of it. */
export function DangerZone({
  slug,
  name,
  node,
  deletion,
}: {
  slug: string;
  name: string;
  node: string;
  deletion: Deletion;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  /* On when it can be taken: the box is the last chance to keep the
     world, and somebody who does not want it unticks it knowingly. */
  const [finalBackup, setFinalBackup] = useState(deletion.finalBackupBlocked === null);
  /* Off until it is ticked, and ticking it is the person saying the machine is gone: the panel then removes its record and asks the machine
     for nothing. */
  const [forget, setForget] = useState(false);
  const [deleting, startDeleting] = useAction();
  const { push } = useToast();

  function remove() {
    const data = new FormData();
    data.set("slug", slug);
    data.set("confirmation", confirmation);
    if (finalBackup && !forget) data.set("finalBackup", "on");
    if (forget) data.set("forget", "on");

    startDeleting(async () => {
      // A refusal comes back; a success redirects and never returns.
      const result = await deleteServer(null, data);
      if (result && !result.ok) push({ tone: "danger", title: result.title, body: result.body });
    });
  }

  return (
    // Linked to as #delete from a node being retired.
    <div id="delete" className="scroll-mt-[124px] rounded-[14px] border border-danger-line bg-card px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-danger-soft text-danger-fg">
          <TriangleAlert size={13} strokeWidth={2} />
        </span>
        <h3 className="text-[13px] font-semibold">Danger zone</h3>
      </div>
      <p className="mb-[14px] text-[11.5px] leading-relaxed text-ink-3">
        {`Deleting removes the server from its node, with all world data${
          deletion.localBackups > 0
            ? ` and the ${deletion.localBackups === 1 ? "backup" : `${deletion.localBackups} backups`} on its disk`
            : ""
        }. It cannot be undone.`}
        {deletion.offsiteBackups > 0 &&
          ` ${deletion.offsiteBackups === 1 ? "Its off-site backup stays" : `Its ${deletion.offsiteBackups} off-site backups stay`} in the bucket and on the Backups page, and can be restored into another server of the same game.`}
      </p>

      {!open ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-snug text-ink-4">
            Giving it to another member, or moving it to another node, is under Ownership and reuse above.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex self-start items-center justify-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-medium text-danger-fg transition-[filter] duration-150 hover:brightness-110"
          >
            <Trash2 size={13} strokeWidth={1.9} />
            Delete this server
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          <label className="text-[11.5px] text-ink-3" htmlFor="delete-confirm">
            Type <span className="font-mono text-ink">{name}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={name}
            className={inputClass(false, true)}
          />

          <label
            className={`flex items-start gap-[9px] rounded-[10px] border border-line bg-bg-2 px-3 py-[10px] text-[11.5px] leading-snug ${
              deletion.finalBackupBlocked || forget ? "text-ink-4" : "text-ink-2"
            }`}
          >
            <input
              type="checkbox"
              className="mt-[2px]"
              checked={finalBackup && !forget}
              disabled={deleting || forget || deletion.finalBackupBlocked !== null}
              onChange={(e) => setFinalBackup(e.target.checked)}
            />
            <span>
              <span className="font-medium">Take a last backup off-site first.</span>{" "}
              {deletion.finalBackupBlocked ??
                "The world is saved, archived and sent to the bucket before anything is removed, and the backup stays on the Backups page afterwards. If it cannot be taken, nothing is deleted."}
            </span>
          </label>

          {deletion.nodeGone && (
            <label className="flex items-start gap-[9px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[10px] text-[11.5px] leading-snug text-danger-fg">
              <input
                type="checkbox"
                className="mt-[2px]"
                checked={forget}
                disabled={deleting}
                onChange={(e) => setForget(e.target.checked)}
              />
              <span>
                <span className="font-medium">The machine is gone: forget this server.</span> {node} has not answered for a while, so it cannot be told to remove
                anything. Forgetting removes this panel&apos;s record of the server and sends nothing to the machine. If the machine comes back, the server&apos;s
                container and world are still on it, and the panel no longer lists them. It is refused unless {node} answers nothing at all when you press the button.
              </span>
            </label>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmation("");
                setForget(false);
              }}
              disabled={deleting}
              className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={deleting || confirmation.trim() !== name}
              className="ml-auto inline-flex items-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-semibold text-danger-fg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
            >
              <Trash2 size={13} strokeWidth={1.9} />
              {deleting ? (forget ? "Forgetting…" : finalBackup ? "Backing up, then deleting…" : "Deleting…") : forget ? "Forget permanently" : "Delete permanently"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <RotateCw size={12} strokeWidth={1.9} className="text-ink-4" />
        <span className="text-[10.5px] text-ink-4">Every change here is recorded in the audit log.</span>
      </div>
    </div>
  );
}
