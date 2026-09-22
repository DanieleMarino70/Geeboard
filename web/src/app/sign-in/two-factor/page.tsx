import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getCurrentUser, pendingSecondFactor } from "@/lib/auth";
import { TwoFactorForm } from "./two-factor-form";

export const metadata = { title: "Two-factor · Geeboard" };

/* The second step of signing in. Reachable only with the short-lived
   cookie the first step set; anyone else is sent back to the start. */
export default async function TwoFactorPage() {
  if (await getCurrentUser()) redirect("/");
  if (!(await pendingSecondFactor())) redirect("/sign-in");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[376px]">
        <div className="mb-6 flex items-center gap-[10px]">
          <BrandMark size={26} className="shrink-0 text-accent" />
          <span className="text-sm font-semibold tracking-[-0.01em]">Geeboard</span>
        </div>
        <div className="mb-[14px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
          second step
        </div>
        <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]">Your code</h1>
        <p className="mt-3 mb-[30px] text-[13px] leading-relaxed text-ink-3">
          The six digits your authenticator shows for Geeboard — or one of your recovery codes, if
          the phone is gone. You have five minutes.
        </p>
        <TwoFactorForm />
      </div>
    </div>
  );
}
