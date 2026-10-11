"use client";

import { RotateCw, Save, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Dialog } from "@/components/dialog";
import { Badge, Button } from "@/components/ui";
import { COST_BADGE, rebuildSentence, type ChangeSummary, type PendingChange } from "@/lib/settings-summary";

/* The Settings page's one save: at the foot of the window while anything differs from what is saved, above the phone's bottom bar, with
   what changes and what each change costs said before it is pressed. "3 changes · 1 applies at the next restart · 1 needs a rebuild".

   A change that needs the server made again is saved by "Save and rebuild", which asks first in the words the page's old "Rebuild and
   apply" used. A game setting that needs it cannot be saved without it (the save refuses an environment change it cannot apply); new
   resource limits can, and wait for the next rebuild, so for those the question also offers to save and rebuild later. */
export function SaveBar({
  changes,
  summary,
  invalid,
  refusal,
  offerRebuild,
  saving,
  confirming,
  serverName,
  onDiscard,
  onSave,
  onConfirm,
  onShowProblem,
}: {
  changes: PendingChange[];
  summary: ChangeSummary;
  /** Fields whose values the save would refuse, by label: the save waits for them. */
  invalid: string[];
  /** What the last save was refused with, until the next change. */
  refusal: { title: string; body: string } | null;
  /** The save rebuilds the server: a game setting needs it, or new limits and a reader who may rebuild. */
  offerRebuild: boolean;
  saving: boolean;
  confirming: boolean;
  serverName: string;
  onDiscard: () => void;
  /** Save, asking first when a rebuild is part of it. */
  onSave: () => void;
  /** The answer to the question: rebuild now, save and rebuild later, or neither. */
  onConfirm: (answer: "rebuild" | "later" | null) => void;
  onShowProblem: () => void;
}) {
  const laterAllowed = !summary.gameNeedsRebuild;

  return (
    <>
      <div
        role="region"
        aria-label="Unsaved changes"
        className="sticky bottom-[84px] z-20 rounded-[14px] border border-line-2 bg-surface px-4 py-3 shadow-e3 lg:bottom-4"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[260px]">
            <p className="flex items-center gap-2 text-[12.5px] font-medium" aria-live="polite">
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" />
              {summary.sentence}
            </p>
            {refusal && (
              <p role="alert" className="mt-[3px] text-[11.5px] leading-snug text-danger-fg">
                <span className="font-medium">{refusal.title}.</span> {refusal.body}
              </p>
            )}
            {invalid.length > 0 ? (
              <button type="button" onClick={onShowProblem} className="mt-[3px] flex items-center gap-[5px] text-left text-[11.5px] text-danger-fg underline underline-offset-2">
                <TriangleAlert size={12} strokeWidth={2} aria-hidden className="shrink-0" />
                {invalid.length === 1 ? `${invalid[0]} needs fixing first` : `${invalid.length} settings need fixing first`}
              </button>
            ) : (
              <details className="group mt-[3px] text-[11.5px] text-ink-3">
                <summary className="cursor-pointer select-none hover:text-ink-2">What changes</summary>
                <ChangeList changes={changes} className="mt-2 max-h-[30vh] overflow-y-auto" />
              </details>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button intent="ghost" disabled={saving} onClick={onDiscard}>
              Discard
            </Button>
            <Button
              intent={offerRebuild ? "destructive" : "primary"}
              icon={offerRebuild ? RotateCw : Save}
              disabled={saving || invalid.length > 0}
              onClick={onSave}
            >
              {saving ? (offerRebuild ? "Saving and rebuilding…" : "Saving…") : offerRebuild ? "Save and rebuild" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={confirming} onClose={() => onConfirm(null)} title={`Rebuild ${serverName}?`} width={520}>
        <p className="text-[12.5px] leading-relaxed text-ink-2">{rebuildSentence(changes)}</p>
        <ChangeList changes={changes} className="mt-4 rounded-[10px] border border-line bg-bg-2 px-3 py-2" />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button intent="ghost" data-autofocus onClick={() => onConfirm(null)}>
            Cancel
          </Button>
          {laterAllowed && (
            <Button intent="secondary" icon={Save} onClick={() => onConfirm("later")}>
              Save, rebuild later
            </Button>
          )}
          <Button intent="destructive" icon={RotateCw} onClick={() => onConfirm("rebuild")}>
            Rebuild and apply
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function ChangeList({ changes, className }: { changes: PendingChange[]; className?: string }) {
  return (
    <ul className={clsx("flex flex-col", className)}>
      {changes.map((c) => (
        <li key={`${c.section}-${c.key}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line py-[6px] text-[11.5px] last:border-b-0">
          {/* Both halves can have a "Server name": the game's, in its server list, and the panel's. */}
          <span className="font-medium text-ink-2">
            <span className="font-normal text-ink-3">{c.section === "game" ? "Game" : "Server"} · </span>
            {c.label}
          </span>
          <span className="min-w-0 text-ink-3">
            {c.from} <span aria-hidden>→</span>
            <span className="sr-only">to</span> <span className="text-ink-2">{c.to}</span>
          </span>
          {c.cost !== "now" && (
            <span className="ml-auto">
              <Badge tone={c.cost === "rebuild" ? "warning" : "muted"}>{COST_BADGE[c.cost]}</Badge>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
