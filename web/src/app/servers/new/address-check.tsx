"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowUpRight, Check, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { checkServerAddress } from "@/app/actions/dns";
import type { AddressVerdict } from "@/domain/dns/address";

const TONE: Record<AddressVerdict["tone"], { box: string; icon: typeof Check; ink: string }> = {
  success: { box: "border-success-line bg-success-soft", icon: Check, ink: "text-success" },
  info: { box: "border-accent-line bg-accent-soft", icon: Info, ink: "text-accent" },
  warning: { box: "border-warning-line bg-warning-soft", icon: TriangleAlert, ink: "text-warning" },
  muted: { box: "border-line bg-card-2", icon: Info, ink: "text-ink-4" },
};

/* What the address typed into the wizard comes to, said once it is typed.

   After a short pause it asks the panel whether the name exists, where it
   points, and what that means for this workspace — a record Geeboard will
   write, one somebody else made, or none at all — and says so under the
   field. Where no DNS provider is set and the name would have been better
   for one, it offers the page that sets it up, in a new tab, so the draft
   stays where it is; "Check again" asks once more when they are back. */
export function AddressCheck({ host, valid }: { host: string; valid: boolean }) {
  const [again, setAgain] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; verdict: AddressVerdict | null } | null>(null);

  /* What is being asked, as one key: the name, and how many times "Check
     again" has been pressed. An answer belongs to the key it was asked for, so
     a later keystroke makes an earlier one stale without anything to cancel,
     and "checking" is simply there being a key without an answer to it. */
  const name = host.trim().toLowerCase();
  const wanted = name && valid ? name : null;
  const key = wanted ? `${wanted}#${again}` : null;

  useEffect(() => {
    if (!key || !wanted) return;
    let live = true;
    const timer = setTimeout(async () => {
      let verdict: AddressVerdict | null = null;
      try {
        const out = await checkServerAddress(wanted);
        verdict = out.ok ? out.verdict : null;
      } catch {
        verdict = null;
      }
      if (live) setAnswer({ key, verdict });
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, wanted]);

  const checking = key !== null && answer?.key !== key;
  const verdict = key !== null && answer?.key === key ? answer.verdict : null;

  if (!checking && !verdict) return null;

  if (checking) {
    return (
      <p className="mt-3 flex items-center gap-[7px] text-[11.5px] text-ink-4" role="status">
        <span className="h-[6px] w-[6px] animate-(--animate-pulse-dot) rounded-full bg-accent" />
        Checking the name…
      </p>
    );
  }

  const tone = TONE[verdict!.tone];
  const Icon = tone.icon;
  return (
    <div className={clsx("mt-3 rounded-[10px] border px-3 py-[11px]", tone.box)} role="status">
      <div className="flex items-start gap-[9px]">
        <Icon size={14} strokeWidth={2} className={clsx("mt-[2px] shrink-0", tone.ink)} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium">{verdict!.title}</div>
          <p className="mt-[3px] text-[11.5px] leading-relaxed text-ink-3">{verdict!.body}</p>
        </div>
      </div>

      {verdict!.offerSetup && (
        <div className="mt-3 flex flex-col gap-[10px] rounded-[9px] border border-line bg-bg-2 p-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold">Want a name of your own?</div>
            <p className="mt-[3px] text-[11.5px] leading-relaxed text-ink-3">
              Connect DuckDNS (free names that follow your machine if its address changes), Cloudflare (a domain you own) or a
              webhook of your own (any other DNS), and Geeboard keeps the record for every server. It opens in a new tab;
              this draft stays as it is.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dns"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-[6px] rounded-lg bg-accent px-3 py-[7px] text-xs font-semibold text-accent-ink hover:brightness-110"
            >
              Set up DNS
              <ArrowUpRight size={13} strokeWidth={2} />
            </Link>
            <button
              type="button"
              onClick={() => setAgain((n) => n + 1)}
              className="inline-flex items-center gap-[6px] rounded-lg px-2 py-[7px] text-xs text-ink-3 hover:bg-card-2 hover:text-ink"
            >
              <RefreshCw size={12} strokeWidth={1.9} />
              Check again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
