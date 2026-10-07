"use client";

import { useEffect, useRef } from "react";
import { ToastDock, useModalPresence } from "./toast";

/* One modal, shared.

   The native <dialog>, as the Add a node dialog already used: focus is
   trapped, Escape closes it, and the page behind is inert without any
   of that written by hand. Each dialog in the panel used to be its own
   pattern — an inline card, window.prompt, window.confirm — and they
   looked and behaved like four different products.

   A message raised while it is open is shown in it (the ToastDock at its foot): a modal dialog makes the rest of the page inert and
   covers it, so a toast on the page was painted under the backdrop and, being inert, was not there for a screen reader either. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalPresence(open);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      /* The children were rendered while the dialog was still display:none, so an autoFocus among them did nothing and the browser
         chose the first thing it could focus, which is the close button. The first field is where a person starts. */
      dialog.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      style={{ width }}
      className="m-auto max-h-[calc(100dvh-40px)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line-2 bg-surface p-0 text-ink shadow-e3 backdrop:bg-[hsl(230_30%_3%/0.62)] backdrop:backdrop-blur-[4px] open:animate-(--animate-rise)"
    >
      {open && (
        <div>
          <div className="flex items-start gap-3 border-b border-line px-6 py-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
              {description && <p className="mt-[5px] text-[12px] leading-snug text-ink-3">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[5px] border border-line px-[6px] py-[2px] font-mono text-[9.5px] text-ink-4 hover:text-ink"
            >
              <span className="sr-only">Close </span>
              ESC
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
          <ToastDock placement="dialog" />
        </div>
      )}
    </dialog>
  );
}
