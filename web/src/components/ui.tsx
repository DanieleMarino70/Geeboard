import clsx from "clsx";
import type { Tone } from "@/lib/ui-types";

/* ── Pill: status is never colour alone — every state carries a word,
   and transitional states carry motion. ───────────────────────────── */

const PILL_TONE: Record<Tone, string> = {
  success: "text-success bg-success-soft border-success-line",
  warning: "text-warning bg-warning-soft border-warning-line",
  danger: "text-danger bg-danger-soft border-danger-line",
  info: "text-info bg-info-soft border-info-line",
  accent: "text-accent bg-accent-soft border-accent-line",
  muted: "text-ink-4 bg-card-2 border-line",
};

export function Pill({
  children,
  tone = "success",
  pulse = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  pulse?: boolean;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-[7px] rounded-full border px-[10px] py-[4px] font-mono text-[10.5px] tracking-[0.03em]",
        PILL_TONE[tone],
      )}
    >
      <span
        className={clsx(
          "h-[5px] w-[5px] shrink-0 rounded-full bg-current",
          pulse && "animate-(--animate-pulse-dot)",
        )}
      />
      {children}
    </span>
  );
}

export function Badge({ children, tone = "accent" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.06em]",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ── Button: four intents and no more. Destructive is always outlined
   rather than filled, so a red block never sits where a primary
   action would. ───────────────────────────────────────────────────── */

type Intent = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const INTENT: Record<Intent, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold shadow-[0_8px_22px_-14px_var(--accent)] hover:brightness-110",
  secondary:
    "border border-line bg-card text-ink-2 font-medium hover:border-line-2 hover:text-ink",
  ghost: "text-ink-3 hover:text-ink hover:bg-card-2",
  destructive:
    "border border-danger-line bg-danger-soft text-danger font-medium hover:brightness-110",
};

const SIZE: Record<Size, string> = {
  sm: "px-3 py-[6px] rounded-lg text-xs",
  md: "px-4 py-[9px] rounded-[9px] text-[13px]",
  lg: "px-[22px] py-3 rounded-[11px] text-sm",
};

export function Button({
  children,
  intent = "primary",
  size = "md",
  icon: Icon,
  className,
  ...rest
}: {
  children?: React.ReactNode;
  intent?: Intent;
  size?: Size;
  icon?: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-[7px] whitespace-nowrap",
        "transition-[filter,transform,background-color,border-color,color] duration-150",
        "active:translate-y-px active:scale-[0.985]",
        "disabled:pointer-events-none disabled:opacity-45",
        INTENT[intent],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={size === "sm" ? 13 : 14} strokeWidth={1.9} /> : null}
      {children}
    </button>
  );
}

/* ── Card ─────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-[14px] border border-line bg-card shadow-e1",
        hover &&
          "transition-[border-color,transform] duration-200 ease-(--ease-out-soft) hover:-translate-y-[2px] hover:border-line-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Meter ────────────────────────────────────────────────────────── */

export function Meter({
  value,
  colour = "var(--accent)",
  height = 4,
}: {
  value: number;
  colour?: string;
  height?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-full bg-card-2"
      style={{ height }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-(--ease-out-soft)"
        style={{ width: `${value}%`, background: colour }}
      />
    </div>
  );
}

/* ── Labels ───────────────────────────────────────────────────────── */

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Avatar & cover art ───────────────────────────────────────────── */

export function Avatar({
  initials,
  size = 30,
  rounded = "50%",
}: {
  initials: string;
  size?: number;
  rounded?: string;
}) {
  return (
    <div
      className="grid shrink-0 place-items-center bg-linear-140 from-card-2 to-line-2 font-semibold text-ink-2"
      style={{ width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.37) }}
    >
      {initials}
    </div>
  );
}

/* Striped placeholder — the design system's stand-in until real
   artwork is supplied. */
export function Cover({ tag, size = 46, radius = 11 }: { tag: string; size?: number; radius?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center border border-line"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background:
          "repeating-linear-gradient(135deg, var(--card-2) 0 6px, var(--bg-2) 6px 12px)",
      }}
    >
      <span
        className="text-center font-mono leading-tight text-ink-3"
        style={{ fontSize: size > 60 ? 10 : 8 }}
      >
        {tag}
      </span>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────── */

export function Spark({ points, colour, id }: { points: number[]; colour: string; id: string }) {
  const step = 120 / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${p}`).join(" ");
  return (
    <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden className="block h-7 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.28" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0 28 ${path.slice(1)} L120 28 Z`} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={colour} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
