"use client";

import { useEffect, useRef } from "react";

/* Focus for something that has just replaced what had it.

   A control that swaps itself for another (Revoke for Cancel and Confirm, a form for the secret it just made, a list for the next
   one) unmounts the element that had focus, and the browser puts focus on the document: the next Tab starts again at the top of the
   page, and a screen reader says nothing about what is new. Put the ref on the thing a person should land on (the safe button of a
   confirmation, the first field of a form that opened, the heading of what was revealed, which takes `tabIndex={-1}`). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
