"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, RefreshCw, Trash2 } from "lucide-react";
import { checkStorage, configureStorage, removeStorage, setScheduledOffsite } from "@/app/actions/backups";
import { useToast } from "@/components/toast";
import { Badge, Button } from "@/components/ui";
import type { OpResult } from "@/lib/server-ops";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[8px] text-[12.5px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

export interface StorageView {
  configured: boolean;
  endpoint?: string;
  region?: string;
  bucket?: string;
  prefix?: string;
  pathStyle?: boolean;
  accessKeyMask?: string;
  scheduledOffsite?: boolean;
  checkedAt?: string | null;
  checkError?: string | null;
  offsiteCount: number;
  offsiteGb: number;
}

function useOp() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<OpResult>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) {
        then?.();
        router.refresh();
      }
    });
  return { run, pending };
}

/* The bucket, as much of it as a browser may see: where it is and a
   mask of the key id. The keys are typed once, into a form that is
   emptied when it has been saved, and never come back. */
export function StorageSettings({ storage, canManage }: { storage: StorageView; canManage: boolean }) {
  const { run, pending } = useOp();
  const [editing, setEditing] = useState(!storage.configured);
  const [armed, setArmed] = useState(false);
  const [form, setForm] = useState({
    endpoint: storage.endpoint ?? "",
    region: storage.region ?? "us-east-1",
    bucket: storage.bucket ?? "",
    prefix: storage.prefix ?? "geeboard",
    pathStyle: storage.pathStyle ?? true,
    accessKeyId: "",
    secretAccessKey: "",
    scheduledOffsite: storage.scheduledOffsite ?? true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  if (!canManage && !storage.configured) {
    return <p className="text-[11.5px] leading-relaxed text-ink-4">No off-site storage is configured. An owner or admin can add a bucket.</p>;
  }

  if (storage.configured && !editing) {
    return (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-[6px] font-mono text-[10.5px]">
          <dt className="text-ink-4">bucket</dt>
          <dd className="truncate text-ink-2">{storage.bucket}{storage.prefix ? `/${storage.prefix}` : ""}</dd>
          <dt className="text-ink-4">endpoint</dt>
          <dd className="truncate text-ink-2">{storage.endpoint}</dd>
          <dt className="text-ink-4">region</dt>
          <dd className="text-ink-2">{storage.region} · {storage.pathStyle ? "path-style" : "virtual-hosted"}</dd>
          <dt className="text-ink-4">key</dt>
          <dd className="text-ink-2">{storage.accessKeyMask} · secret not shown</dd>
          <dt className="text-ink-4">holds</dt>
          <dd className="text-ink-2">{storage.offsiteCount} archive{storage.offsiteCount === 1 ? "" : "s"} · {storage.offsiteGb.toFixed(2)} GB</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {storage.checkError ? (
            <Badge tone="danger">last check failed</Badge>
          ) : storage.checkedAt ? (
            <Badge tone="success">answered {new Date(storage.checkedAt).toLocaleString("en-GB")}</Badge>
          ) : null}
        </div>
        {storage.checkError && <p className="text-[11px] leading-snug text-danger">{storage.checkError}</p>}
        {canManage && (
          <>
            <label className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <input
                type="checkbox"
                checked={storage.scheduledOffsite ?? false}
                disabled={pending}
                onChange={(e) => run(() => setScheduledOffsite(e.target.checked))}
              />
              Send scheduled backups off-site
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" intent="secondary" icon={RefreshCw} disabled={pending} onClick={() => run(() => checkStorage())}>
                Test the bucket
              </Button>
              <Button size="sm" intent="ghost" disabled={pending} onClick={() => setEditing(true)}>
                Change keys
              </Button>
              {armed ? (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeStorage(), () => setArmed(false))}
                    className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
                  >
                    Forget the bucket
                  </button>
                </span>
              ) : (
                <Button size="sm" intent="ghost" icon={Trash2} disabled={pending} onClick={() => setArmed(true)}>
                  Remove
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-[10px]"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => configureStorage(form),
          () => {
            setForm((f) => ({ ...f, accessKeyId: "", secretAccessKey: "" }));
            setEditing(false);
          },
        );
      }}
    >
      <label className="block">
        <span className="mb-[5px] block text-[11.5px] font-medium">Endpoint</span>
        <input id="st-endpoint" required placeholder="https://s3.eu-west-1.amazonaws.com or http://localhost:9000" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-[10px]">
        <label className="block">
          <span className="mb-[5px] block text-[11.5px] font-medium">Bucket</span>
          <input id="st-bucket" required value={form.bucket} onChange={(e) => set("bucket", e.target.value)} className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-[5px] block text-[11.5px] font-medium">Region</span>
          <input id="st-region" required value={form.region} onChange={(e) => set("region", e.target.value)} className={FIELD} />
        </label>
      </div>
      <label className="block">
        <span className="mb-[5px] block text-[11.5px] font-medium">Prefix</span>
        <input id="st-prefix" value={form.prefix} onChange={(e) => set("prefix", e.target.value)} placeholder="geeboard" className={FIELD} />
      </label>
      <label className="block">
        <span className="mb-[5px] block text-[11.5px] font-medium">Access key id</span>
        <input id="st-key" required autoComplete="off" value={form.accessKeyId} onChange={(e) => set("accessKeyId", e.target.value)} className={FIELD} />
      </label>
      <label className="block">
        <span className="mb-[5px] block text-[11.5px] font-medium">Secret access key</span>
        <input id="st-secret" type="password" required autoComplete="new-password" value={form.secretAccessKey} onChange={(e) => set("secretAccessKey", e.target.value)} className={FIELD} />
      </label>
      <label className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <input type="checkbox" checked={form.pathStyle} onChange={(e) => set("pathStyle", e.target.checked)} />
        Path-style addressing (MinIO and most self-hosted stores; off for Amazon)
      </label>
      <label className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <input type="checkbox" checked={form.scheduledOffsite} onChange={(e) => set("scheduledOffsite", e.target.checked)} />
        Send scheduled backups off-site
      </label>
      <p className="text-[11px] leading-relaxed text-ink-4">
        Saved only if the bucket accepts a test upload. The keys are stored encrypted and are not shown
        again; nodes are handed short-lived signed URLs and never see them.
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" icon={CloudUpload} disabled={pending}>
          {pending ? "Testing…" : "Test and save"}
        </Button>
        {storage.configured && (
          <button type="button" onClick={() => setEditing(false)} className="text-[11.5px] text-ink-4 hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
