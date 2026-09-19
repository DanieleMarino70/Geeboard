"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, CloudUpload } from "lucide-react";
import { createBackup } from "@/app/actions/servers";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

/* Backups are per-server, so this asks which one before firing.

   It used to default to a list of the sample workspace's servers, and
   with no servers at all it offered an empty choice and a button that
   sent nothing anywhere. With a bucket configured it also asks where:
   the node's own disk, or off-site. */
export function BackupNowButton({
  servers,
  offsite,
}: {
  servers: Array<{ slug: string; name: string }>;
  /** A bucket is configured, so off-site is on offer. */
  offsite: boolean;
}) {
  const [slug, setSlug] = useState(servers[0]?.slug ?? "");
  const [store, setStore] = useState<"LOCAL" | "S3">(offsite ? "S3" : "LOCAL");
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = () =>
    startTransition(async () => {
      const r = await createBackup(slug, store);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      router.refresh();
    });

  if (servers.length === 0) {
    return (
      <Button icon={Archive} disabled title="There is no server you can back up">
        Back up now
      </Button>
    );
  }

  const select =
    "rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[12.5px] text-ink-2 outline-none transition-colors duration-150 hover:border-line-2 focus:border-accent-line";

  return (
    <span className="flex flex-wrap items-center gap-2">
      {servers.length > 1 && (
        <>
          <label className="sr-only" htmlFor="backup-server">
            Server to back up
          </label>
          <select id="backup-server" value={slug} onChange={(e) => setSlug(e.target.value)} className={select}>
            {servers.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      )}
      {offsite && (
        <>
          <label className="sr-only" htmlFor="backup-store">
            Where to keep it
          </label>
          <select id="backup-store" value={store} onChange={(e) => setStore(e.target.value as "LOCAL" | "S3")} className={select}>
            <option value="S3">Off-site, in the bucket</option>
            <option value="LOCAL">On the node</option>
          </select>
        </>
      )}
      <Button icon={store === "S3" ? CloudUpload : Archive} disabled={pending || !slug} onClick={run}>
        {pending
          ? store === "S3"
            ? "Archiving and uploading…"
            : "Backing up…"
          : servers.length === 1
            ? `Back up ${servers[0]!.name}`
            : "Back up now"}
      </Button>
    </span>
  );
}
