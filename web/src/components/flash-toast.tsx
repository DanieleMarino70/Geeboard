"use client";

import { useEffect, useRef } from "react";
import { clearFlash } from "@/app/actions/flash";
import type { Flash } from "@/domain/flash";
import { useToast } from "./toast";

/* Shows the message a server action left on a cookie before it redirected (see domain/flash.ts), once, and then clears the cookie.
   Keyed by the message's id, so React running the effect twice in development, or the layout rendering again, does not show it twice. */
export function FlashToast({ flash }: { flash: Flash | null }) {
  const { push } = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!flash || shown.current === flash.id) return;
    shown.current = flash.id;
    push({ tone: flash.tone, title: flash.title, body: flash.body });
    void clearFlash().catch(() => {
      /* the cookie ends by itself in two minutes; the message is already on screen */
    });
  }, [flash, push]);
  return null;
}
