"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { useFocusOnMount } from "@/components/use-focus-on-mount";
import { useAction } from "@/components/use-action";
import clsx from "clsx";
import { Ban, Check, Trash2 } from "lucide-react";
import { deleteApiKey, revokeApiKey } from "@/app/actions/apikeys";
import { useToast } from "@/components/toast";

export function KeyRowActions({
  id,
  name,
  revoked,
}: {
  id: string;
  name: string;
  revoked: boolean;
}) {
  const [pending, startTransition] = useAction();
  const [armed, setArmed] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<Awaited<ReturnType<typeof revokeApiKey>>>) =>
    startTransition(async () => {
      const r = await fn();
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      setArmed(false);
      router.refresh();
    });

  if (revoked) {
    return (
      <button
        type="button"
        aria-label={`Remove ${name} from the list`}
        title="Remove the record"
        disabled={pending}
        onClick={() => run(() => deleteApiKey(id))}
        className={clsx(
          "grid h-[26px] w-[26px] place-items-center justify-self-end rounded-[7px] transition-colors duration-150",
          pending ? "opacity-40" : "text-ink-4 hover:bg-card-2 hover:text-ink",
        )}
      >
        <Trash2 size={14} strokeWidth={1.7} />
      </button>
    );
  }

  return armed ? (
    <span className="flex items-center justify-end gap-1">
      <button autoFocus
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => revokeApiKey(id))}
        className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
      >
        Revoke
      </button>
    </span>
  ) : (
    <button
      type="button"
      aria-label={`Revoke ${name}`}
      title="Revoke this key"
      onClick={() => setArmed(true)}
      className="grid h-[26px] w-[26px] place-items-center justify-self-end rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
    >
      <Ban size={14} strokeWidth={1.7} />
    </button>
  );
}

/* The secret is shown once, right after creation, and never again. */
export function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const shown = useRef<HTMLElement>(null);
  // What was just made is where focus goes: the form that had it is gone, and the secret is the next thing to do something with.
  const landing = useFocusOnMount<HTMLDivElement>();

  return (
    <div
      ref={landing}
      tabIndex={-1}
      data-autofocus
      role="group"
      aria-label="Your new secret, shown once"
      className="rounded-[14px] border border-accent-line bg-card px-5 py-[18px] outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [background:linear-gradient(180deg,var(--accent-soft),transparent_70%),var(--card)]"
    >
      <div className="mb-3 flex items-center gap-[11px]">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Check size={14} strokeWidth={2.6} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Copy this now</div>
          <div className="mt-[3px] text-[11.5px] text-ink-3">
            This is the only time the full secret is shown. Store it in your secret manager.
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto shrink-0 rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:bg-card-2 hover:text-ink"
        >
          Done
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-[10px] rounded-[10px] border border-line bg-con-bg px-[13px] py-[11px]">
        {/* Wrapped, not cut: a setup link is some seventy-five characters, and an ellipsis on a phone made it impossible to read or check. */}
        <code ref={shown} className="min-w-0 flex-1 basis-64 font-mono text-xs break-all text-con-ink select-all">{secret}</code>
        <CopyButton text={secret} source={shown} />
      </div>
    </div>
  );
}
