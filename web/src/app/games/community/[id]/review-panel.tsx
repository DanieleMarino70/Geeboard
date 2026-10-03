"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck, Undo2 } from "lucide-react";
import { approveManifest, rejectManifest, retireGame } from "@/app/actions/community";
import { Field, Notice, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";

/* The three things that can be said about a revision. What is approved is what the page showed: the hash it was
   drawn from goes with the code, and the server refuses if it is not the stored one. */

export function ReviewPanel({
  revisionId,
  gameId,
  gameName,
  hash,
  state,
  canApprove,
  passes,
}: {
  revisionId: string;
  gameId: string;
  gameName: string;
  hash: string;
  state: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "RETIRED";
  canApprove: boolean;
  /** The manifest passes the rules as they are now; one that does not cannot be approved. */
  passes: boolean;
}) {
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const say = (r: { ok: boolean; tone?: "success" | "warning"; title: string; body: string }) => {
    push({ tone: r.ok ? (r.tone ?? "success") : "danger", title: r.title, body: r.body });
    setError(r.ok ? null : r.body);
    if (r.ok) router.refresh();
  };

  if (state === "APPROVED") {
    return (
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[14px] font-semibold">This revision is approved</h2>
        <p className="max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
          {gameName} is in the create wizard, and can be placed on a node that has declared community-games. Retiring it takes it out of the wizard. A server that
          already runs it is not stopped, not changed, and can still be managed; only new ones are refused.
        </p>
        {armed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button intent="destructive" size="sm" icon={Ban} disabled={pending} onClick={() => start(async () => say(await retireGame(gameId)))}>
              Retire {gameName}
            </Button>
            <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[11px] text-ink-4 hover:text-ink">
              Cancel
            </button>
          </div>
        ) : (
          <div>
            <Button intent="secondary" size="sm" icon={Undo2} onClick={() => setArmed(true)}>
              Retire…
            </Button>
          </div>
        )}
      </Card>
    );
  }

  if (state !== "PENDING") {
    return (
      <Card className="p-5 text-[12px] leading-relaxed text-ink-3">
        This revision is {state === "REJECTED" ? "turned down" : state === "SUPERSEDED" ? "replaced by a later one" : "retired"}. It runs nothing and cannot be approved. To use it, propose it again.
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-[14px] font-semibold">Decide</h2>
        <p className="mt-[5px] max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
          Approving says that the images above may run, as root in their containers, on every node that has declared community-games, with the reach described. It is
          tied to this manifest&apos;s hash — <span className="font-mono">{hash.slice(0, 16)}…</span> — and to a code you give now.
        </p>
      </div>

      {canApprove ? (
        <Field label="Authenticator code" htmlFor="approve-code" hint="The current six digits — not the code you signed in with; that one is spent." error={error}>
          <input
            id="approve-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            className={`${inputClass(Boolean(error), true)} sm:max-w-[14rem]`}
            disabled={!passes}
          />
        </Field>
      ) : (
        <Notice tone="info">Only an owner can approve. You can read this, and turn it down.</Notice>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canApprove && (
          <Button
            icon={ShieldCheck}
            disabled={pending || !passes || code.replace(/\s/g, "").length !== 6}
            onClick={() => start(async () => say(await approveManifest(revisionId, { hash, code })))}
          >
            {pending ? "Approving…" : "Approve"}
          </Button>
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Why, if turning it down"
          aria-label="Reason for turning it down"
          className={`${inputClass(false)} sm:max-w-[20rem]`}
        />
        <Button intent="destructive" icon={Ban} disabled={pending} onClick={() => start(async () => say(await rejectManifest(revisionId, note)))}>
          Turn down
        </Button>
      </div>
    </Card>
  );
}
