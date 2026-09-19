"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { completeSetup } from "@/app/actions/account";
import { PASSWORD_MIN } from "@/domain/access/account";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-[13px] py-[11px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 focus:border-accent-line";

export function SetupForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");

  const submit = () => {
    setError(null);
    if (password !== again) {
      setError("The two passwords are not the same.");
      return;
    }
    start(async () => {
      const r = await completeSetup(token, password);
      if (!r.ok) {
        setError(`${r.title}. ${r.body}`);
        return;
      }
      router.push("/sign-in?set=1");
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-[18px]"
    >
      {error ? (
        <div role="alert" className="flex items-start gap-[10px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[11px]">
          <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0 text-danger" />
          <span className="text-[12px] leading-snug text-danger">{error}</span>
        </div>
      ) : null}

      <div>
        <label htmlFor="password" className="mb-[7px] block text-xs font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={PASSWORD_MIN}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
        <p className="mt-[6px] text-[11px] text-ink-4">At least {PASSWORD_MIN} characters. Length is the only rule.</p>
      </div>

      <div>
        <label htmlFor="again" className="mb-[7px] block text-xs font-medium">
          Once more
        </label>
        <input
          id="again"
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          className={FIELD}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-[18px] py-3 text-[13.5px] font-semibold text-accent-ink transition-[filter] duration-150 hover:brightness-110 disabled:pointer-events-none disabled:opacity-70"
      >
        {pending ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}
