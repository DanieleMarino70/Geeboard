"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import {
  beginTwoFactor,
  changePassword,
  confirmTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  signOutEverywhere,
} from "@/app/actions/account";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { PASSWORD_MIN } from "@/domain/access/account";
import type { OpResult } from "@/lib/server-ops";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";
const CODE = `${FIELD} font-mono tracking-[0.1em]`;

function useOp() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const run = <T extends OpResult>(fn: () => Promise<T>, then?: (r: T) => void) =>
    start(async () => {
      const r = await fn();
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) {
        then?.(r);
        router.refresh();
      }
    });
  return { run, pending };
}

/* ── Password ─────────────────────────────────────────────────────── */

export function PasswordForm() {
  const { run, pending } = useOp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const { push } = useToast();

  return (
    <form
      className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== again) {
          push({ tone: "danger", title: "Check the new password", body: "The two copies are not the same." });
          return;
        }
        run(
          () => changePassword(current, next),
          () => {
            setCurrent("");
            setNext("");
            setAgain("");
          },
        );
      }}
    >
      <label className="block">
        <span className="mb-[6px] block text-xs font-medium">Current password</span>
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
      </label>
      <label className="block">
        <span className="mb-[6px] block text-xs font-medium">New password</span>
        <input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} className={FIELD} />
      </label>
      <label className="block">
        <span className="mb-[6px] block text-xs font-medium">Once more</span>
        <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
      </label>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending || !current || !next}>
          Change password
        </Button>
      </div>
    </form>
  );
}

/* ── Sessions ─────────────────────────────────────────────────────── */

export function SessionsPanel({ others }: { others: number }) {
  const { run, pending } = useOp();
  return (
    <div className="mt-3">
      <Button intent="secondary" size="sm" icon={LogOut} disabled={pending || others === 0} onClick={() => run(() => signOutEverywhere())}>
        Sign out other devices
      </Button>
    </div>
  );
}

/* ── Two-factor ───────────────────────────────────────────────────── */

/* Recovery codes, shown once. The list is what the person has to keep;
   copying all ten at once is the way most people will. */
/* A QR code from rows of "1" and "0" — see lib/qr.ts. One path of unit
   squares, always dark on white whatever the theme: a scanner wants the
   contrast the standard assumes, and an inverted code is one some phones
   will not read. */
function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const size = rows.length;
  let path = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") path += `M${x} ${y}h1v1h-1z`;
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="mt-[10px] h-[188px] w-[188px] rounded-[8px] border border-line bg-white"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

function CodesReveal({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-[14px] border border-accent-line bg-card px-5 py-[18px] [background:linear-gradient(180deg,var(--accent-soft),transparent_70%),var(--card)]">
      <div className="mb-3 flex items-center gap-[11px]">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Check size={14} strokeWidth={2.6} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Your recovery codes</div>
          <div className="mt-[3px] text-[11.5px] text-ink-3">
            Each works once, in place of the authenticator. This is the only time they are shown.
          </div>
        </div>
        <button type="button" onClick={onDone} className="ml-auto shrink-0 rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:bg-card-2 hover:text-ink">
          I have saved them
        </button>
      </div>
      <div className="rounded-[10px] border border-line bg-con-bg px-[13px] py-[11px]">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-con-ink sm:grid-cols-5">
          {codes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(codes.join("\n"));
          setCopied(true);
        }}
        className="mt-3 inline-flex items-center gap-[6px] rounded-lg border border-line bg-card px-3 py-[6px] text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-line-2 hover:text-ink"
      >
        {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.9} />}
        {copied ? "Copied" : "Copy all"}
      </button>
    </div>
  );
}

export function TwoFactorPanel({
  enabled,
  required,
  recoveryCodesLeft,
}: {
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}) {
  const { run, pending } = useOp();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  if (codes) return <CodesReveal codes={codes} onDone={() => setCodes(null)} />;

  if (!enabled) {
    if (!setup) {
      return (
        <div className="mt-4">
          <Button size="sm" icon={ShieldCheck} disabled={pending} onClick={() => run(() => beginTwoFactor(), (r) => r.secret && r.uri && setSetup({ secret: r.secret, uri: r.uri, qr: r.qr ?? [] }))}>
            Set up two-factor
          </Button>
        </div>
      );
    }
    return (
      <div className="mt-4 flex flex-col gap-4">
        <div className="rounded-[10px] border border-line bg-bg-2 px-4 py-3">
          <div className="text-[12px] font-medium">1 · Add Geeboard to your authenticator</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">
            Scan the code with the app, or type the secret into it, or open the link on the phone
            that has it — all three are the same secret. The code is drawn by this panel; the secret
            is sent to no other service.
          </p>
          {setup.qr.length > 0 && <QrCode rows={setup.qr} label="Two-factor setup code for your authenticator app" />}
          <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
            <code className="rounded-[8px] border border-line bg-con-bg px-3 py-[7px] font-mono text-[13px] tracking-[0.14em] text-con-ink">
              {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(setup.secret);
                setCopied(true);
              }}
              className="inline-flex items-center gap-[6px] rounded-lg border border-line bg-card px-3 py-[6px] text-xs font-medium text-ink-2 hover:border-line-2 hover:text-ink"
            >
              {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.9} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a href={setup.uri} className="text-[11.5px] text-accent hover:underline">
              Open in an authenticator app
            </a>
          </div>
        </div>
        <form
          className="rounded-[10px] border border-line bg-bg-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => confirmTwoFactor(code),
              (r) => {
                setSetup(null);
                setCode("");
                if (r.codes) setCodes(r.codes);
              },
            );
          }}
        >
          <div className="text-[12px] font-medium">2 · Type the code it shows</div>
          <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
            <input aria-label="Code from your authenticator" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={`${CODE} max-w-[180px]`} />
            <Button type="submit" size="sm" disabled={pending || code.trim().length < 6}>
              Turn on
            </Button>
            <button type="button" onClick={() => setSetup(null)} className="text-[11.5px] text-ink-4 hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <form
        className="rounded-[10px] border border-line bg-bg-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => regenerateRecoveryCodes(code),
            (r) => {
              setCode("");
              if (r.codes) setCodes(r.codes);
            },
          );
        }}
      >
        <div className="text-[12px] font-medium">
          Recovery codes · {recoveryCodesLeft} of 10 left
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">
          New codes replace the old ones. Confirm with the code your authenticator shows now.
        </p>
        <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
          <input aria-label="Code from your authenticator" inputMode="numeric" autoComplete="one-time-code" required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={`${CODE} max-w-[180px]`} />
          <Button type="submit" intent="secondary" size="sm" disabled={pending || code.trim().length < 6}>
            Regenerate codes
          </Button>
        </div>
      </form>

      {required ? (
        <p className="text-[11.5px] leading-relaxed text-ink-4">
          Two-factor stays on for your role. New phone? Regenerate the codes, then have an owner
          reset your password if the old authenticator is gone.
        </p>
      ) : (
        <form
          className="rounded-[10px] border border-line bg-bg-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => disableTwoFactor(password, code),
              () => {
                setPassword("");
                setCode("");
              },
            );
          }}
        >
          <div className="text-[12px] font-medium">Turn off</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">Your password and a current code.</p>
          <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
            <input type="password" aria-label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${FIELD} max-w-[200px]`} />
            <input aria-label="Code from your authenticator" inputMode="numeric" required placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={`${CODE} max-w-[160px]`} />
            <Button type="submit" intent="destructive" size="sm" icon={ShieldOff} disabled={pending || !password || code.trim().length < 6}>
              Turn off two-factor
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
