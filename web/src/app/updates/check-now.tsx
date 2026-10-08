"use client";

import { RefreshCw } from "lucide-react";
import { checkUpdatesNow } from "@/app/actions/panel-updates";
import { useAction } from "@/components/use-action";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

/* Asks now. The panel asks by itself at most twice a day; this is for somebody who has just heard that a release is out. */
export function CheckNow({ enabled }: { enabled: boolean }) {
  const [pending, start] = useAction();
  const { push } = useToast();
  return (
    <Button
      intent="secondary"
      size="sm"
      icon={RefreshCw}
      disabled={pending || !enabled}
      title={enabled ? "Ask now whether a newer release is out" : "Update checks are off on this panel (GEEBOARD_UPDATE_CHECK=off)"}
      onClick={() =>
        start(async () => {
          const r = await checkUpdatesNow();
          push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
        })
      }
    >
      {pending ? "Checking…" : "Check now"}
    </Button>
  );
}
