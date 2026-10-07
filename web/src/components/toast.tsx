"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

type ToastTone = "success" | "warning" | "danger";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body: string;
}

interface Store {
  toasts: Toast[];
  /** Dialogs open at the moment. A modal dialog makes the rest of the page inert and paints a backdrop over it, so a message raised
      while one is open has to be shown inside it, or it is neither seen nor heard. */
  modals: number;
  dismiss: (id: number) => void;
  enterModal: () => () => void;
}

const ToastContext = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);
const StoreContext = createContext<Store | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/** Called by a dialog while it is open (see Dialog), so that messages go where the person is looking. */
export function useModalPresence(open: boolean) {
  const store = useContext(StoreContext);
  const enter = store?.enterModal;
  useEffect(() => {
    if (!open || !enter) return;
    return enter();
  }, [open, enter]);
}

const TONE = {
  success: { icon: Check, className: "text-success bg-success-soft" },
  warning: { icon: AlertTriangle, className: "text-warning bg-warning-soft" },
  danger: { icon: X, className: "text-danger bg-danger-soft" },
} as const;

/* How long a message stays. A failure stays until it is dismissed: the sentence that says what went wrong and what to do about it is
   a few lines long, and six seconds is not enough to read it aloud, let alone to look away from the screen and back. A success and a
   warning go by themselves, and every one of them waits while the pointer is on it, while focus is in it and while the tab is hidden. */
export const STAYS_MS = { success: 8000, warning: 20000, danger: null } as const;

const subscribeHidden = (fn: () => void) => {
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
};
const isHidden = () => document.hidden;

/* The messages are written to the activity log only when the operation behind them wrote one; a refusal or a form's own complaint
   does not, so a toast is never the only copy a person is asked to rely on for something that matters: failures stay on screen. */
function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { icon: Icon, className } = TONE[toast.tone];
  const [held, setHeld] = useState(false);
  const hidden = useSyncExternalStore(subscribeHidden, isHidden, () => false);
  const paused = held || hidden;
  const ms = STAYS_MS[toast.tone];
  const left = useRef<number>(ms ?? 0);

  useEffect(() => {
    if (ms === null || paused) return;
    const began = Date.now();
    const t = setTimeout(() => onDismiss(toast.id), left.current);
    return () => {
      clearTimeout(t);
      left.current -= Date.now() - began;
    };
  }, [ms, paused, toast.id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="flex animate-(--animate-rise) items-start gap-3 rounded-[10px] border border-line-2 bg-surface px-4 py-[14px] shadow-e3"
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-[7px] ${className}`}>
        <Icon size={13} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold">{toast.title}</div>
        <div className="mt-[3px] text-[11.5px] leading-snug break-words text-ink-3">{toast.body}</div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mt-1 -mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:text-ink"
      >
        <X size={14} strokeWidth={1.9} />
      </button>
    </div>
  );
}

/* Two live regions, each there before anything is put in it, which is when a screen reader is listening: a failure is an alert and is
   spoken at once, the rest are status and wait their turn. A card is not a live region of its own: nested ones are read twice or not at all. */
export function ToastDock({ placement }: { placement: "page" | "dialog" }) {
  const store = useContext(StoreContext);
  if (!store) return null;
  const inDialog = placement === "dialog";
  const mine = store.toasts.filter((t) => (inDialog ? store.modals > 0 && t.tone !== "success" : store.modals === 0 || t.tone === "success"));
  const alerts = mine.filter((t) => t.tone === "danger");
  const rest = mine.filter((t) => t.tone !== "danger");
  const card = (t: Toast) => (
    <div key={t.id} className="pointer-events-auto">
      <ToastCard toast={t} onDismiss={store.dismiss} />
    </div>
  );
  return (
    <div
      className={
        inDialog
          ? "flex flex-col gap-[10px] px-6 pb-5 empty:hidden"
          : "pointer-events-none fixed right-5 bottom-24 z-90 flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-[10px] lg:bottom-6"
      }
    >
      <div role="alert" className="flex flex-col gap-[10px]">
        {alerts.map(card)}
      </div>
      <div role="status" className="flex flex-col gap-[10px]">
        {rest.map(card)}
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modals, setModals] = useState(0);

  const push = useCallback((t: Omit<Toast, "id">) => {
    // Failures are kept, so there is room for a few; the others are the last three.
    setToasts((prev) => [...prev.filter((p) => p.tone === "danger").slice(-3), ...prev.filter((p) => p.tone !== "danger").slice(-2), { ...t, id: Date.now() + Math.random() }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const enterModal = useCallback(() => {
    setModals((n) => n + 1);
    return () => setModals((n) => Math.max(0, n - 1));
  }, []);

  const api = useMemo(() => ({ push }), [push]);
  const store = useMemo<Store>(() => ({ toasts, modals, dismiss, enterModal }), [toasts, modals, dismiss, enterModal]);

  return (
    <ToastContext.Provider value={api}>
      <StoreContext.Provider value={store}>
        {children}
        <ToastDock placement="page" />
      </StoreContext.Provider>
    </ToastContext.Provider>
  );
}
