import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in · Geeboard" };

/* What Geeboard is, not how popular it is. The panel measures nothing
   about itself, and the three figures that used to stand here — uptime,
   servers under management, median latency — were written into this
   file. A sign-in page is the first thing anybody reads; it should not
   open with numbers nobody counted. */
const POINTS = [
  ["Your machines", "A node is a computer you already have, running Docker and the agent."],
  ["Your data", "Worlds, snapshots and settings stay on your nodes. Nothing is uploaded anywhere."],
  ["Open source", "AGPL-3.0. Read it, change it, run it."],
] as const;

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/");
  // The seed's credentials are printed in development only.
  const demo = process.env.NODE_ENV !== "production";

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
            A panel for the game servers you host yourself: install, start, back up, read the
            console and hand out the keys, without learning a different tool for every game.
          </p>
          <div className="mt-9 flex flex-col gap-5">
            {POINTS.map(([title, caption]) => (
              <div key={title} className="max-w-[46ch]">
                <div className="text-[14px] font-semibold tracking-[-0.01em]">{title}</div>
                <div className="mt-[5px] text-[12px] leading-relaxed text-ink-4">{caption}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-[14px] font-mono text-[10.5px] text-ink-4">
          <span>self-hosted</span>
          <span className="h-[3px] w-[3px] rounded-full bg-ink-4" />
          <span>AGPL-3.0-only</span>
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-center p-6 sm:p-12 lg:w-[560px]">
        <SignInForm demo={demo} />
      </div>
    </div>
  );
}
