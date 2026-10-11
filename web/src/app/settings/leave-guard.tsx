"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui";

/* Leaving the Settings page with changes it has not saved asks first.

   Closing the tab or reloading is the browser's own question (beforeunload: it writes the words). A link inside the panel — the sidebar, a
   tab, the server switcher — is a navigation the browser never sees, so it is caught on its way to the link, before Next's router has it,
   and the panel asks in its own dialog: stay, or leave and lose them. A link to a place on this page (the section map) is not leaving.
   The browser's Back button is not caught: the App Router gives no way to hold it, and a page that fought it would be worse. */
export function LeaveGuard({ dirty, count }: { dirty: boolean; count: number }) {
  const router = useRouter();
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const armed = useRef(dirty);
  useEffect(() => {
    armed.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!armed.current) return;
      e.preventDefault();
      // Older browsers ask only when a value is set; none of them shows it.
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      if (!armed.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      // The same page, to a place on it.
      if (to.pathname === window.location.pathname && to.search === window.location.search && to.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setLeavingTo(to.pathname + to.search + to.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    // Captured on the document, so it runs before the link's own handler and Next's router never starts.
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, []);

  return (
    <Dialog
      open={leavingTo !== null}
      onClose={() => setLeavingTo(null)}
      title="Leave without saving?"
      width={440}
      description={`${count} change${count === 1 ? "" : "s"} on this page ${count === 1 ? "has" : "have"} not been saved, and will be lost.`}
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button intent="ghost" data-autofocus onClick={() => setLeavingTo(null)}>
          Stay on this page
        </Button>
        <Button
          intent="destructive"
          onClick={() => {
            const to = leavingTo;
            armed.current = false;
            setLeavingTo(null);
            if (to) router.push(to);
          }}
        >
          {count === 1 ? "Leave and lose it" : "Leave and lose them"}
        </Button>
      </div>
    </Dialog>
  );
}
