import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in · Geeboard" };

const PROOF = [
  ["99.98%", "panel uptime, 90 days"],
  ["2.1M", "servers under management"],
  ["14 ms", "median node latency"],
] as const;

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <div className="flex min-h-screen bg-bg">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-line bg-bg-2 p-14 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[260px] -left-[120px] h-[640px] w-[720px] rounded-full"
          style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-28"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />

        <div className="relative flex items-center gap-[11px]">
          <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-accent text-accent-ink shadow-[0_0_0_1px_var(--accent-line),0_8px_24px_-10px_var(--accent)]">
            <Zap size={17} strokeWidth={2.4} />
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Geeboard</span>
        </div>

        <div className="relative max-w-[34ch]">
          <h1 className="text-[clamp(34px,4vw,46px)] leading-[1.04] font-semibold tracking-[-0.04em]">
            Run the server. Not the server software.
          </h1>
          <p className="mt-[22px] max-w-[44ch] text-[15px] leading-[1.65] text-ink-2">
            Snapshots that verify themselves, a console that keeps up with a busy world, and
            permissions your moderators can actually understand.
          </p>
          <div className="mt-9 flex gap-8">
            {PROOF.map(([value, caption]) => (
              <div key={caption}>
                <div className="text-[22px] font-semibold tracking-[-0.03em] tnum">{value}</div>
                <div className="mt-[5px] text-[11.5px] text-ink-4">{caption}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-[14px] font-mono text-[10.5px] text-ink-4">
          <span>v3.2 · community</span>
          <span className="h-[3px] w-[3px] rounded-full bg-ink-4" />
          <span>status: all systems normal</span>
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-center p-6 sm:p-12 lg:w-[560px]">
        <SignInForm />
      </div>
    </div>
  );
}
