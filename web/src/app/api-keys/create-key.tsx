"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, TriangleAlert } from "lucide-react";
import { createApiKey, type KeyState } from "@/app/actions/apikeys";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui";
import { SecretReveal } from "./key-actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink shadow-[0_8px_22px_-14px_var(--accent)] transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-45"
    >
      {pending ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent-ink border-t-transparent" />
      ) : (
        <Plus size={14} strokeWidth={1.9} />
      )}
      Create key
    </button>
  );
}

export function CreateKey({ scopes }: { scopes: ReadonlyArray<{ id: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [state, formAction] = useActionState<KeyState, FormData>(createApiKey, null);
  const { push } = useToast();
  const router = useRouter();

  /* Both the reveal and the form's visibility are derived from the
     action result rather than mirrored into state, so the effect only
     has to announce the outcome. */
  const secret = state?.ok && state.secret && state.secret !== dismissed ? state.secret : null;
  const showForm = open && !secret;

  useEffect(() => {
    if (!state) return;
    push(
      state.ok
        ? { tone: state.tone, title: state.title, body: state.body }
        : { tone: "danger", title: state.title, body: state.body },
    );
    if (state.ok) router.refresh();
  }, [state, push, router]);

  return (
    <div className="flex flex-col gap-4">
      {secret && (
        <SecretReveal
          secret={secret}
          onDone={() => {
            setDismissed(secret);
            setOpen(false);
          }}
        />
      )}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-fit items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink shadow-[0_8px_22px_-14px_var(--accent)] transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px"
        >
          <Plus size={14} strokeWidth={1.9} />
          Create key
        </button>
      ) : (
        <Card className="p-[22px]">
          <form action={formAction} className="flex flex-col gap-[18px]">
            <div>
              <h2 className="mb-1 text-sm font-semibold tracking-[-0.015em]">New API key</h2>
              <p className="text-[11.5px] leading-snug text-ink-4">
                Least privilege by default — pick only the scopes this key needs.
              </p>
            </div>

            {state && !state.ok && (
              <div
                role="alert"
                className="flex items-start gap-[10px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[11px]"
              >
                <TriangleAlert size={14} strokeWidth={2} className="mt-px shrink-0 text-danger" />
                <span className="text-xs leading-snug text-danger">
                  <strong className="font-semibold">{state.title}.</strong> {state.body}
                </span>
              </div>
            )}

            <div>
              <label htmlFor="key-name" className="mb-[7px] block text-xs font-medium">
                Name
              </label>
              <input
                id="key-name"
                name="name"
                required
                maxLength={60}
                placeholder="Production deploy"
                className="w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[10px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line"
              />
            </div>

            <fieldset>
              <legend className="mb-[10px] text-xs font-medium">Scopes</legend>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {scopes.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-[11px] border-b border-line py-[9px]"
                  >
                    <input type="checkbox" name="scopes" value={s.id} className="peer sr-only" />
                    <span className="mt-px grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border border-line-2 peer-checked:border-accent peer-checked:bg-accent">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--accent-ink)"
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="opacity-0 peer-checked:opacity-100"
                      >
                        <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[11.5px]">{s.id}</span>
                      <span className="mt-[2px] block text-[11px] text-ink-4">{s.label}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[9px] px-4 py-[9px] text-[13px] text-ink-3 hover:bg-card-2 hover:text-ink"
              >
                Cancel
              </button>
              <span className="ml-auto">
                <Submit />
              </span>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
