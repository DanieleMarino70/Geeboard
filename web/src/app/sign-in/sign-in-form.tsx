"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, GitBranch, Lock, Zap } from "lucide-react";
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

export function SignInForm() {
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
      <p className="mt-3 mb-[30px] text-[13px] leading-relaxed text-ink-3">
        Use your Geeboard account. Passkeys work in every browser we ship.
      </p>

      <form action={formAction} className="flex flex-col gap-[18px]">
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
            defaultValue="mara@ashfold.gg"
            placeholder="you@example.com"
            className={FIELD}
          />
        </div>

        <div>
          <div className="mb-[7px] flex items-baseline gap-2">
            <label htmlFor="password" className="text-xs font-medium">
              Password
            </label>
            <a href="/forgot" className="ml-auto text-[11.5px] text-accent hover:underline">
              Forgot?
            </a>
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

        <label className="flex cursor-pointer items-center gap-[11px]">
          <input type="checkbox" name="remember" defaultChecked className="peer sr-only" />
          <span className="grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border border-line-2 transition-colors duration-150 peer-checked:border-accent peer-checked:bg-accent">
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
          <span className="text-[12.5px] text-ink-2">Keep me signed in on this device</span>
        </label>

        <Submit />

        <div className="my-[2px] flex items-center gap-[14px]">
          <span className="h-px flex-1 bg-(--border)" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">or</span>
          <span className="h-px flex-1 bg-(--border)" />
        </div>

        <div className="flex flex-col gap-2">
          {(
            [
              [Lock, "Continue with a passkey"],
              [GitBranch, "Continue with GitHub"],
            ] as const
          ).map(([Icon, labelText]) => (
            <button
              key={labelText}
              type="button"
              disabled
              title="Not wired up yet"
              className="flex w-full items-center justify-center gap-[9px] rounded-[10px] border border-line bg-card px-[18px] py-[11px] text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-line-2 disabled:opacity-45"
            >
              <Icon size={15} strokeWidth={1.7} />
              {labelText}
            </button>
          ))}
        </div>
      </form>

      <p className="mt-7 text-center text-[11.5px] leading-relaxed text-ink-4">
        No account? Ask your server owner for an invite.
      </p>
      <p className="mt-3 text-center font-mono text-[10.5px] text-ink-4">
        seeded login · mara@ashfold.gg / geeboard
      </p>
    </div>
  );
}
