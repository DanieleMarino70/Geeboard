"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { createBackup } from "@/app/actions/servers";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

/* Backups are per-server, so this asks which one before firing. */
export function BackupNowButton({
  servers = [
    { slug: "aurora", name: "Aurora SMP" },
    { slug: "creative", name: "Ashfold Creative" },
    { slug: "nightfall", name: "Nightfall PvP" },
    { slug: "wipe", name: "Wipe Wednesday" },
  ],
}: {
  servers?: Array<{ slug: string; name: string }>;
}) {
  const [slug, setSlug] = useState(servers[0]?.slug ?? "");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = () =>
    startTransition(async () => {
      const r = await createBackup(slug);
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });

  return (
    <span className="flex items-center gap-2">
      <label className="sr-only" htmlFor="backup-server">
        Server to back up
      </label>
      <select
        id="backup-server"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[12.5px] text-ink-2 outline-none transition-colors duration-150 hover:border-line-2 focus:border-accent-line"
      >
        {servers.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
      <Button icon={Archive} disabled={pending} onClick={run}>
        Back up now
      </Button>
    </span>
  );
}
