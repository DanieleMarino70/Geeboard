"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

type ToastTone = "success" | "warning" | "danger";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body: string;
}

const ToastContext = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE = {
  success: { icon: Check, className: "text-success bg-success-soft" },
  warning: { icon: AlertTriangle, className: "text-warning bg-warning-soft" },
  danger: { icon: X, className: "text-danger bg-danger-soft" },
} as const;

/* Toasts never carry the only copy of an important message — every one
   of these also lands in the activity log. */
function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { icon: Icon, className } = TONE[toast.tone];

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="status"
      className="flex animate-(--animate-rise) items-start gap-3 rounded-[10px] border border-line-2 bg-surface px-4 py-[14px] shadow-e3"
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-[7px] ${className}`}>
        <Icon size={13} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold">{toast.title}</div>
        <div className="mt-[3px] text-[11.5px] leading-snug text-ink-3">{toast.body}</div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="mt-px grid shrink-0 place-items-center text-ink-4 transition-colors duration-150 hover:text-ink"
      >
        <X size={13} strokeWidth={1.9} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    setToasts((prev) => [...prev.slice(-2), { ...t, id: Date.now() + Math.random() }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-24 z-90 flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-[10px] lg:bottom-6"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastCard toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
