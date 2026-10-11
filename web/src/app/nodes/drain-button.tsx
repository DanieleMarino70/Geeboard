"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/use-action";
import { Download, Play } from "lucide-react";
import { setNodeDrain } from "@/app/actions/nodes";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

/* Draining takes a node out of placement and does nothing else: its servers keep running, and Resume node puts it back as it was
   (setNodeDrainOp). So it stays one click, unlike Reject and Remove, which lose something. It was drawn red, the colour of those two, and
   the audit of 2026-10-11 asked why it alone did not ask first; it says now that it can be undone instead. */
export function DrainButton({
  name,
  draining,
  size = "md",
}: {
  name: string;
  draining: boolean;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useAction();
  const { push } = useToast();
  const router = useRouter();
  const noteId = useId();

  const run = () =>
    startTransition(async () => {
      const r = await setNodeDrain(name, !draining);
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });

  return draining ? (
    <Button intent="secondary" size={size} icon={Play} disabled={pending} onClick={run}>
      Resume node
    </Button>
  ) : (
    <span className="inline-flex flex-col items-start gap-[3px]">
      <Button intent="secondary" size={size} icon={Download} disabled={pending} onClick={run} aria-describedby={noteId}>
        Drain node
      </Button>
      <span id={noteId} className="text-[10.5px] leading-tight text-ink-4">
        Reversible: no new servers here until resumed
      </span>
    </span>
  );
}
