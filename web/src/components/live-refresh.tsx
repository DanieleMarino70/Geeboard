"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { nextRefreshIn } from "@/domain/refresh";

/* A page that keeps itself current while something on it is changing.

   Nothing updated by itself. The poller writes a server's state every fifteen seconds, but a page was drawn once: after Start it said
   "Starting" with a pulsing dot until somebody reloaded, which a person takes for nothing having happened and presses again. The refreshes
   that followed an action were at 4 and 6.5 seconds, numbers tuned to the simulator. This asks the server to draw the page again, every five
   seconds, only while `active` (a server or a node on the page is in a state that is about to change on its own), only while the tab is
   showing, every fifteen seconds after two minutes, and not at all after ten: a download that long has its own line. It also draws once as soon
   as a tab that was away comes back. One render for each viewer for each interval, during transitions only. */

export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const began = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const age = Date.now() - began;
      const wait = nextRefreshIn(age);
      if (wait === null) return;
      if (document.visibilityState === "visible") router.refresh();
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, nextRefreshIn(0)!);

    const back = () => {
      if (document.visibilityState === "visible" && nextRefreshIn(Date.now() - began) !== null) router.refresh();
    };
    document.addEventListener("visibilitychange", back);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [active, router]);

  return null;
}
