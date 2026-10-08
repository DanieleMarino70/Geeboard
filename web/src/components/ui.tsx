import Link from "next/link";
import clsx from "clsx";
import { coverFor } from "@/components/covers";
import type { Tone } from "@/lib/ui-types";

/* ── Pill: status is never colour alone — every state carries a word,
   and transitional states carry motion. ───────────────────────────── */

const PILL_TONE: Record<Tone, string> = {
  success: "text-success-fg bg-success-soft border-success-line",
  warning: "text-warning-fg bg-warning-soft border-warning-line",
  danger: "text-danger-fg bg-danger-soft border-danger-line",
  info: "text-info-fg bg-info-soft border-info-line",
  accent: "text-accent-fg bg-accent-soft border-accent-line",
  muted: "text-ink-4 bg-card-2 border-line",
};

export function Pill({
  children,
  tone = "success",
  pulse = false,
  title,
}: {
  children: React.ReactNode;
  tone?: Tone;
  pulse?: boolean;
  /** What the word means, for a hover: the sentence, never instead of the word. */
  title?: string;
}) {
  return (
    <span
      title={title}
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

/* A disabled primary is grey, not a paler green. Faded, it still read as
   the one thing to press: "Save changes" looked ready on a Settings page
   nobody had touched. The inset shadow draws its outline without a
   border, so the button keeps its size. */
/* Hover is for a button that can be pressed: `not-disabled:` and not a bare `hover:`, because a disabled button now receives the pointer (so
   that its cursor says not-allowed and its title can explain why), and it must not light up under it. It is `not-disabled` and not `enabled`
   because a LinkButton is an anchor, which `:enabled` never matches. */
const INTENT: Record<Intent, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold shadow-[0_8px_22px_-14px_var(--accent)] not-disabled:hover:brightness-110 disabled:bg-card-2 disabled:text-ink-4 disabled:shadow-[inset_0_0_0_1px_var(--border)]",
  secondary:
    "border border-line bg-card text-ink-2 font-medium not-disabled:hover:border-line-2 not-disabled:hover:text-ink disabled:opacity-45",
  ghost: "text-ink-3 not-disabled:hover:text-ink not-disabled:hover:bg-card-2 disabled:opacity-45",
  destructive:
    "border border-danger-line bg-danger-soft text-danger-fg font-medium not-disabled:hover:brightness-110 disabled:opacity-45",
};

const SIZE: Record<Size, string> = {
  sm: "px-3 py-[6px] rounded-lg text-xs",
  md: "px-4 py-[9px] rounded-[9px] text-[13px]",
  lg: "px-[22px] py-3 rounded-[11px] text-sm",
};

function buttonClass(intent: Intent, size: Size, className?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center gap-[7px] whitespace-nowrap",
    "transition-[filter,transform,background-color,border-color,color] duration-150",
    "not-disabled:active:translate-y-px not-disabled:active:scale-[0.985]",
    INTENT[intent],
    SIZE[size],
    className,
  );
}

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
  ref?: React.Ref<HTMLButtonElement>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={buttonClass(intent, size, className)} {...rest}>
      {Icon ? <Icon size={size === "sm" ? 13 : 14} strokeWidth={1.9} /> : null}
      {children}
    </button>
  );
}

/* A link that carries a button's weight. Navigation is a link, not a
   button with an onClick — it opens in a new tab, it has an address. */
export function LinkButton({
  href,
  children,
  intent = "primary",
  size = "md",
  icon: Icon,
  className,
}: {
  href: string;
  children?: React.ReactNode;
  intent?: Intent;
  size?: Size;
  icon?: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(intent, size, className)}>
      {Icon ? <Icon size={size === "sm" ? 13 : 14} strokeWidth={1.9} /> : null}
      {children}
    </Link>
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

/* A bar is announced by what it measures, and there are several to a page ("progressbar 12" three times over, with nothing to say whose),
   so the label is not optional: the caller says what it is the percentage of ("Aurora CPU"), and the value is read as "12 percent". */
export function Meter({
  value,
  label,
  colour = "var(--accent)",
  height = 4,
}: {
  value: number;
  label: string;
  colour?: string;
  height?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-full bg-card-2"
      style={{ height }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuetext={`${value} percent`}
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
      aria-hidden
      className="grid shrink-0 place-items-center bg-linear-140 from-card-2 to-line-2 font-semibold text-ink-2"
      style={{ width: size, height: size, borderRadius: rounded, fontSize: Math.round(size * 0.37) }}
    >
      {initials}
    </div>
  );
}

/* Striped placeholder — the design system's stand-in until real
   artwork is supplied.

   Both this and Avatar are decoration beside a name: a cover was announced as "MC JAVA" or "TERR- ARIA" (the art's own two lines of
   text) before the game's real name, and an avatar as its initials. A screen reader gets the name next to them and nothing else. */
/* A game's cover, or the stripes that stood in for one.

   `game` is a definition's id, and the drawing is looked up by it
   (covers.tsx). A game nobody has drawn — one just added, a server whose
   catalog row has gone — falls back to what this always was: stripes and
   the definition's `art`, which is two lines of text. Never a broken
   image, never a hole where a square should be. */
export function Cover({
  tag,
  game,
  size = 46,
  radius = 11,
}: {
  tag: string;
  game?: string | null;
  size?: number;
  radius?: number;
}) {
  const art = coverFor(game);

  if (art) {
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden
        className="block shrink-0 border border-line"
        style={{ borderRadius: radius }}
      >
        <rect width="64" height="64" fill={art.background} />
        {art.shapes}
      </svg>
    );
  }

  return (
    <div
      aria-hidden
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
