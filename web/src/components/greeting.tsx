"use client";

import { useHydrated } from "./local-time";

/* "Good morning, Mara", by the reader's clock. It was by the server's: on a VPS in UTC a reader in Rome at nine in the evening was
   told good afternoon, and the text React drew in the browser differed from the one the server sent. Plain "Hello" until the browser has
   taken over, and then what the reader's own hour says. */
export function Greeting({ name }: { name: string }) {
  const hydrated = useHydrated();
  if (!hydrated) return <>Hello, {name}</>;
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return (
    <>
      Good {part}, {name}
    </>
  );
}
