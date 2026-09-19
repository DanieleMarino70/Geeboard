"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { verifySecondFactor, type SignInState } from "@/app/actions/auth";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-[13px] py-[11px] font-mono text-[15px] tracking-[0.12em] outline-none transition-colors duration-150 placeholder:text-ink-4 placeholder:tracking-normal focus:border-accent-line";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-[18px] py-3 text-[13.5px] font-semibold text-accent-ink transition-[filter] duration-150 hover:brightness-110 disabled:pointer-events-none disabled:opacity-70"
    >
      {pending ? "Checking…" : "Continue"}
    </button>
  );
}

export function TwoFactorForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(verifySecondFactor, {});

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      {state.error ? (
        <div role="alert" className="flex items-start gap-[10px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[11px]">
          <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0 text-danger" />
          <span className="text-[12px] leading-snug text-danger">{state.error}</span>
        </div>
      ) : null}

      <div>
        <label htmlFor="code" className="mb-[7px] block text-xs font-medium">
          Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder="123456 or a recovery code"
          className={FIELD}
        />
      </div>

      <Submit />

      <p className="text-center text-[11.5px] leading-relaxed text-ink-4">
        Lost both? An owner or admin can reset your password from Members, which turns two-factor
        off for you. <Link href="/sign-in" className="text-ink-3 hover:text-ink">Start over</Link>
      </p>
    </form>
  );
}
