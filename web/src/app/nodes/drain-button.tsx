"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Download, Play } from "lucide-react";
import { setNodeDrain } from "@/app/actions/members";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

export function DrainButton({
  name,
  draining,
  size = "md",
}: {
  name: string;
  draining: boolean;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = () =>
    startTransition(async () => {
      const r = await setNodeDrain(name, !draining);
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });

  return draining ? (
    <Button intent="secondary" size={size} icon={Play} disabled={pending} onClick={run}>
      Resume node
    </Button>
  ) : (
    <Button intent="destructive" size={size} icon={Download} disabled={pending} onClick={run}>
      Drain node
    </Button>
  );
}
