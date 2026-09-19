"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { moveServer } from "@/app/actions/servers";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import type { MoveCandidate } from "@/lib/move-ops";

/* Moving a server to another node: which one, what it will cost, and a
   deliberate second press. The blockers come from the operation's own
   checks, so a node that cannot take the server says why here rather
   than after the button. */
export function MoveServer({
  slug,
  name,
  currentNode,
  candidates,
  offsite,
  running,
  localBackups,
  lockedLocal,
}: {
  slug: string;
  name: string;
  currentNode: string;
  candidates: MoveCandidate[];
  /** A bucket is configured — the move goes through it. */
  offsite: boolean;
  running: boolean;
  /** Backups on this node, which go with it. */
  localBackups: number;
  /** Locked ones, which stop the move until unlocked. */
  lockedLocal: number;
}) {
  const able = candidates.filter((c) => !c.blocker);
  const [target, setTarget] = useState(able[0]?.name ?? "");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const chosen = candidates.find((c) => c.name === target);

  const move = () =>
    start(async () => {
      const r = await moveServer(slug, target);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      setConfirming(false);
      if (r.ok) router.push(`/servers/${slug}`);
      else router.refresh();
    });

  const blocked = !offsite
    ? "A move goes through the off-site bucket, and none is configured. Set one up on the Backups page first."
    : lockedLocal > 0
      ? `${lockedLocal} locked backup${lockedLocal === 1 ? " lives" : "s live"} on ${currentNode} and would be lost with it. Unlock ${lockedLocal === 1 ? "it" : "them"} on the Backups page first.`
      : candidates.length === 0
        ? "There is no other node."
        : able.length === 0
          ? "No other node can take this server right now."
          : null;

  return (
    // Linked to as #move from a node being retired.
    <div id="move" className="scroll-mt-6 rounded-[14px] border border-line bg-card px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-accent-soft text-accent">
          <ArrowRightLeft size={13} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold">Move to another node</h2>
      </div>
      <p className="mb-[14px] text-[11.5px] leading-relaxed text-ink-3">
        The server is stopped, backed up to the bucket, provisioned on the other node, restored there
        from that backup and started again if it was running. Its address stays; its port may change.
        The copy on {currentNode} is removed last, together with{" "}
        {localBackups === 0 ? "any local backups" : `its ${localBackups} local backup${localBackups === 1 ? "" : "s"}`};
        off-site backups stay.
      </p>

      {blocked ? (
        <p className="text-[11px] leading-snug text-ink-4">{blocked}</p>
      ) : (
        <div className="flex flex-col gap-[10px]">
          <label className="block">
            <span className="mb-[6px] block text-xs font-medium">To</span>
            <select
              id="move-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setConfirming(false);
              }}
              className="w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 hover:border-line-2 focus:border-accent-line"
            >
              {candidates.map((c) => (
                <option key={c.name} value={c.name} disabled={Boolean(c.blocker)}>
                  {c.name} · {c.city}{c.blocker ? ` — ${c.blocker}` : ""}
                </option>
              ))}
            </select>
          </label>
          {chosen?.blocker && <p className="text-[11px] leading-snug text-danger">{chosen.blocker}</p>}
          {confirming && (
            <p className="text-[11.5px] leading-relaxed text-ink-2">
              {running ? `Players on ${name} are disconnected while it moves. ` : ""}
              This takes as long as a backup, an upload and a download of the world take.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={ArrowRightLeft}
              disabled={pending || !chosen || Boolean(chosen.blocker)}
              onClick={() => (confirming ? move() : setConfirming(true))}
            >
              {pending ? "Moving…" : confirming ? `Move to ${target} now` : "Move"}
            </Button>
            {confirming && !pending && (
              <button type="button" onClick={() => setConfirming(false)} className="text-[11.5px] text-ink-4 hover:text-ink">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
