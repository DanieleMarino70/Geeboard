import clsx from "clsx";
import { TriangleAlert } from "lucide-react";

/* Form pieces, shared so every form in the panel reads the same: a label
   that says whether the field is optional, a hint that becomes the error
   when there is one, and inputs styled one way. */

export function inputClass(invalid = false, mono = false) {
  return clsx(
    "w-full rounded-[9px] border bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 disabled:opacity-50",
    mono && "font-mono text-[12.5px]",
    invalid ? "border-danger-line" : "border-line hover:border-line-2 focus:border-accent-line",
  );
}

export function Field({
  label,
  hint,
  error,
  optional = false,
  htmlFor,
  aside,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  htmlFor?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-baseline gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">
          {label}
          {optional && <span className="ml-[6px] font-normal text-ink-4">optional</span>}
        </label>
        {aside && <span className="ml-auto font-mono text-[10px] text-ink-4">{aside}</span>}
      </div>
      {children}
      {(error || hint) && (
        <span
          id={htmlFor ? `${htmlFor}-hint` : undefined}
          role={error ? "alert" : undefined}
          className={clsx("text-[11px] leading-snug", error ? "text-danger" : "text-ink-4")}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "warning" | "danger" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={clsx(
        "flex gap-[9px] rounded-[9px] border px-3 py-[10px] text-[11.5px] leading-relaxed",
        tone === "warning" && "border-warning-line bg-warning-soft text-warning",
        tone === "danger" && "border-danger-line bg-danger-soft text-danger",
        tone === "info" && "border-info-line bg-info-soft text-info",
      )}
    >
      <TriangleAlert size={14} strokeWidth={1.9} className="mt-[2px] shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
