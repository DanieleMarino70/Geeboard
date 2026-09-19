"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { ArrowRightLeft, Check, Circle, Trash2, TriangleAlert } from "lucide-react";
import { removeNode } from "@/app/actions/nodes";
import { useToast } from "@/components/toast";

/* Retiring a node, as the steps it takes rather than a button that
   refuses. Somebody who wants a machine gone should be able to see from
   this card alone what is left to do, in what order, and why — and the
   removal only unlocks once the machine has nothing on it the panel
   would lose track of. */

export function RetireNode({
  name,
  servers,
  serverLinks,
  outOfRotation,
  hasAgent,
}: {
  name: string;
  servers: number;
  /* Where each one is deleted. The step used to say "delete its servers"
     and stop there, and the delete is on a server's settings page, which
     nothing on this page pointed at. */
  serverLinks: Array<{ name: string; slug: string }>;
  outOfRotation: boolean;
  hasAgent: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [removing, start] = useTransition();
  const ready = servers === 0 && outOfRotation;

  const steps = [
    {
      done: servers === 0,
      label: servers === 0 ? "No servers on it" : `Move or delete its ${servers} server${servers === 1 ? "" : "s"}`,
      detail:
        "A move carries a server to another node through the off-site bucket. Deleting removes its container, world and backups from the machine.",
    },
    {
      done: outOfRotation,
      label: outOfRotation ? "Drained" : "Drain it",
      detail: "So nothing new is placed here while it is being retired.",
    },
    {
      done: false,
      label: "Remove it",
      detail: hasAgent
        ? "Forgets the node and its agent token. Then stop the agent on the machine."
        : "Forgets the node.",
    },
  ];

  const remove = () =>
    start(async () => {
      const result = await removeNode(name, confirmation);
      if (!result.ok) {
        push({ tone: "danger", title: result.title, body: result.body });
        return;
      }
      // The Nodes page says what is left to do; a toast would not survive the navigation.
      router.push(`/nodes?removed=${encodeURIComponent(name)}`);
    });

  return (
    <div className="rounded-[14px] border border-danger-line bg-card px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-danger-soft text-danger">
          <TriangleAlert size={13} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold">Retire this node</h2>
      </div>

      <ol className="mb-[14px] flex flex-col gap-[9px]">
        {steps.map((step, i) => (
          <li key={step.label} className="flex gap-[9px]">
            <span
              className={clsx(
                "mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-full",
                step.done ? "bg-success-soft text-success" : "text-ink-4",
              )}
            >
              {step.done ? <Check size={11} strokeWidth={2.6} /> : <Circle size={11} strokeWidth={2} />}
            </span>
            <span className="min-w-0">
              <span className={clsx("block text-[12px]", step.done ? "text-ink-3" : "text-ink")}>
                <span className="font-mono text-ink-4">{i + 1}</span>&nbsp; {step.label}
              </span>
              <span className="block text-[10.5px] leading-snug text-ink-4">{step.detail}</span>
              {i === 0 && serverLinks.length > 0 && (
                <span className="mt-[6px] flex flex-col gap-[3px]">
                  {serverLinks.map((s) => (
                    <span key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/settings?server=${s.slug}#move`}
                        className="flex items-center gap-[6px] text-[11px] text-accent hover:underline"
                      >
                        <ArrowRightLeft size={11} strokeWidth={1.9} />
                        Move {s.name}
                      </Link>
                      <Link
                        href={`/settings?server=${s.slug}#delete`}
                        className="flex items-center gap-[6px] text-[11px] text-danger hover:underline"
                      >
                        <Trash2 size={11} strokeWidth={1.9} />
                        Delete {s.name}
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {!open ? (
        <button
          type="button"
          disabled={!ready}
          onClick={() => setOpen(true)}
          title={ready ? undefined : "Finish the steps above first"}
          className="inline-flex w-full items-center justify-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-medium text-danger transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Trash2 size={13} strokeWidth={1.9} />
          Remove node
        </button>
      ) : (
        <div className="flex flex-col gap-[10px]">
          <label className="text-[11.5px] text-ink-3" htmlFor="remove-node-confirm">
            Type <span className="font-mono text-ink">{name}</span> to confirm
          </label>
          <input
            id="remove-node-confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={name}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] font-mono text-[12.5px] outline-none placeholder:text-ink-4 focus:border-danger-line"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={removing}
              className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={removing || confirmation.trim() !== name}
              className="ml-auto inline-flex items-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-semibold text-danger transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
            >
              <Trash2 size={13} strokeWidth={1.9} />
              {removing ? "Removing…" : "Remove permanently"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
