"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { rotateAgentToken } from "@/app/actions/nodes";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui";

/* A new agent token for a node that stays in service. Asked for twice,
   because it is a credential change — but it interrupts nothing, and the
   card says what happens to the old token, which is the part that
   matters. The token itself is never on this page: it is made on the
   server and goes to the node. */
export function RotateAgentToken({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const rotate = () =>
    start(async () => {
      const r = await rotateAgentToken(name);
      setConfirming(false);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      router.refresh();
    });

  return (
    <Card className="px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-card-2 text-ink-3">
          <KeyRound size={13} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold">Agent token</h2>
      </div>
      <p className="mb-[14px] text-[11.5px] leading-relaxed text-ink-3">
        The secret between the panel and this machine&apos;s agent. Rotating makes a new one, hands it to the
        agent, and has the agent forget the old one. The node stays in service and its servers are not
        touched. Nobody is shown the token, before or after.
      </p>

      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={rotate}
            className="ml-auto inline-flex items-center gap-[7px] rounded-lg border border-line-2 bg-card-2 px-3 py-[6px] text-xs font-semibold text-ink transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
          >
            <KeyRound size={13} strokeWidth={1.9} />
            {pending ? "Rotating…" : "Rotate now"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-[7px] rounded-lg border border-line-2 bg-card-2 px-3 py-[6px] text-xs font-medium text-ink-2 transition-[filter] duration-150 hover:brightness-110"
        >
          <KeyRound size={13} strokeWidth={1.9} />
          Rotate the agent token
        </button>
      )}
    </Card>
  );
}
