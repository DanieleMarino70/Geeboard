"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Play } from "lucide-react";
import { runTaskNow, toggleTask } from "@/app/actions/backups";
import { useToast } from "@/components/toast";

function useTaskAction() {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<Awaited<ReturnType<typeof toggleTask>>>) =>
    startTransition(async () => {
      const r = await fn();
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });

  return { run, pending };
}

export function RunNowButton({ id, name }: { id: string; name: string }) {
  const { run, pending } = useTaskAction();
  return (
    <button
      type="button"
      aria-label={`Run ${name} now`}
      title="Run now"
      disabled={pending}
      onClick={() => run(() => runTaskNow(id))}
      className={clsx(
        "grid h-[26px] w-[26px] place-items-center rounded-[7px] transition-colors duration-150",
        pending ? "opacity-40" : "text-ink-4 hover:bg-card-2 hover:text-ink",
      )}
    >
      <Play size={13} strokeWidth={1.9} />
    </button>
  );
}

export function TaskToggle({
  id,
  name,
  enabled,
}: {
  id: string;
  name: string;
  enabled: boolean;
}) {
  const { run, pending } = useTaskAction();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? "Pause" : "Enable"} ${name}`}
      disabled={pending}
      onClick={() => run(() => toggleTask(id))}
      className={clsx(
        "flex h-[18px] w-8 shrink-0 justify-self-end rounded-full border p-[2px] transition-colors duration-200",
        enabled ? "justify-end border-accent-line bg-accent" : "justify-start border-line bg-card-2",
        pending && "opacity-50",
      )}
    >
      <span
        className={clsx(
          "h-3 w-3 rounded-full transition-colors duration-200",
          enabled ? "bg-accent-ink" : "bg-ink-4",
        )}
      />
    </button>
  );
}
