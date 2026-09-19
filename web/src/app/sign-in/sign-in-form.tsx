"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Zap } from "lucide-react";
import { signIn, type SignInState } from "@/app/actions/auth";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-[13px] py-[11px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 focus:border-accent-line";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-[18px] py-3 text-[13.5px] font-semibold text-accent-ink shadow-[0_10px_26px_-16px_var(--accent)] transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px active:scale-[0.99] disabled:pointer-events-none disabled:opacity-70"
    >
      {pending ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent-ink border-t-transparent" />
          Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </button>
  );
}

export function SignInForm({ demo, justSet = false }: { demo: boolean; justSet?: boolean }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <div className="w-full max-w-[376px]">
      <div className="mb-6 flex items-center gap-[10px] lg:hidden">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
          <Zap size={16} strokeWidth={2.4} />
        </div>
        <span className="text-sm font-semibold tracking-[-0.01em]">Geeboard</span>
      </div>

      <div className="mb-[14px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
        sign in
      </div>
      <h2 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]">Welcome back</h2>
      {/* No passkeys, no single sign-on: an email and a password is all
          this panel has, and saying otherwise sent people looking for a
          button that was never going to work. */}
      <p className="mt-3 mb-[30px] text-[13px] leading-relaxed text-ink-3">
        Use your Geeboard account. A session lasts two weeks on this device.
      </p>

      <form action={formAction} className="flex flex-col gap-[18px]">
        {justSet && !state.error ? (
          <div role="status" className="rounded-[10px] border border-success-line bg-success-soft px-3 py-[11px] text-[12px] leading-snug text-success">
            Password set. Sign in with it now.
          </div>
        ) : null}
        {state.error ? (
          <div
            role="alert"
            className="flex items-start gap-[10px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[11px]"
          >
            <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0 text-danger" />
            <span className="text-[12px] leading-snug text-danger">{state.error}</span>
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="mb-[7px] block text-xs font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            defaultValue={demo ? "mara@ashfold.gg" : ""}
            placeholder="you@example.com"
            className={FIELD}
          />
        </div>

        <div>
          {/* No "Forgot?": the panel sends no email, so a reset is a
              one-time link an owner or admin makes from Members and hands
              over. A link here would lead nowhere. */}
          <div className="mb-[7px] flex items-baseline gap-2">
            <label htmlFor="password" className="text-xs font-medium">
              Password
            </label>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••••••"
            className={FIELD}
          />
        </div>

        <Submit />
      </form>

      <p className="mt-7 text-center text-[11.5px] leading-relaxed text-ink-4">
        No account, or no password? An owner or admin makes one from Members and hands you a
        one-time link.
      </p>
      {/* Only where the seed has run. A production sign-in page must not
          print credentials, even ones it believes are the demo's. */}
      {demo && (
        <p className="mt-3 text-center font-mono text-[10.5px] text-ink-4">
          development seed · mara@ashfold.gg / geeboard
        </p>
      )}
    </div>
  );
}
