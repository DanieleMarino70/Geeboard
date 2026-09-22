"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { checkWorkshopKey, removeWorkshopKey, setWorkshopKey } from "@/app/actions/mods";
import { useToast } from "@/components/toast";
import { Badge, Button } from "@/components/ui";
import type { OpResult } from "@/lib/server-ops";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[8px] font-mono text-[12px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

/** What the tab may know about the key: where it comes from and whether it works — never the key. */
export interface KeyView {
  source: "environment" | "panel" | null;
  shadowed: boolean;
  unreadable: boolean;
  configuredBy: string | null;
  configuredAt: string | null;
  checkedAt: string | null;
  checkError: string | null;
}

function useOp() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<OpResult>, then?: () => void) =>
    start(async () => {
      const r = await fn();
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) then?.();
      router.refresh();
    });
  return { run, pending };
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB");

/* The Steam key, for owners and admins, on the tab that uses it.

   Typed once into a field that is emptied when it has been saved, and
   never shown again — the tab says who set it, when, and whether Steam
   still takes it. When the panel's environment sets one, that is the key
   in use and the tab says so instead of offering a form that would save
   a key nothing reads. */
export function SteamKey({ view }: { view: KeyView }) {
  const { run, pending } = useOp();
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [key, setKey] = useState("");

  const status =
    view.source === "environment" ? (
      <span className="text-[12px] text-ink-3">
        From the panel&apos;s environment, <span className="font-mono text-[11px]">STEAM_API_KEY</span>
      </span>
    ) : view.source === "panel" ? (
      <span className="text-[12px] text-ink-3">
        Set{view.configuredBy ? ` by ${view.configuredBy}` : ""}
        {view.configuredAt ? `, ${when(view.configuredAt)}` : ""} · not shown
      </span>
    ) : (
      <span className="text-[12px] text-ink-3">None — searching is off, links still work</span>
    );

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] border border-line bg-bg-2 px-[13px] py-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-[7px] text-[12px] font-medium">
            <KeyRound size={13} strokeWidth={1.8} className="text-ink-3" />
            Steam Web API key
          </span>
          {status}
          {view.source === "panel" &&
            (view.checkError ? (
              <Badge tone="danger">refused</Badge>
            ) : view.checkedAt ? (
              <Badge tone="success">accepted {when(view.checkedAt)}</Badge>
            ) : null)}
        </div>

        {!editing && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {view.source !== null && (
              <Button size="sm" intent="ghost" icon={RefreshCw} disabled={pending} onClick={() => run(() => checkWorkshopKey())}>
                Check
              </Button>
            )}
            {view.source !== "environment" && (
              <Button size="sm" intent={view.source === null ? "secondary" : "ghost"} disabled={pending} onClick={() => setEditing(true)}>
                {view.source === null ? "Set a key" : "Replace"}
              </Button>
            )}
            {(view.source === "panel" || view.shadowed || view.unreadable) &&
              (armed ? (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeWorkshopKey(), () => setArmed(false))}
                    className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
                  >
                    Forget the key
                  </button>
                </span>
              ) : (
                <Button size="sm" intent="ghost" icon={Trash2} disabled={pending} onClick={() => setArmed(true)}>
                  Remove
                </Button>
              ))}
          </div>
        )}
      </div>

      {view.source === "panel" && view.checkError && <p className="text-[11px] leading-snug text-danger">{view.checkError}</p>}
      {view.shadowed && (
        <p className="text-[11px] leading-snug text-ink-4">
          A key is also saved here, and is not used while the environment sets one. Remove it from{" "}
          <span className="font-mono">deploy/panel/.env</span> and restart the panel to use the saved one instead.
        </p>
      )}
      {view.unreadable && (
        <p className="text-[11px] leading-snug text-danger">
          A key is saved here, and this panel cannot decrypt it — its SECRETS_KEY has changed since. Set it again.
        </p>
      )}

      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => setWorkshopKey(key),
              () => {
                setKey("");
                setEditing(false);
              },
            );
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              id="steam-key"
              type="password"
              required
              autoComplete="new-password"
              spellCheck={false}
              placeholder="32 letters and digits"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className={`${FIELD} min-w-[220px] flex-1`}
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Asking Steam…" : "Test and save"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setKey("");
                setEditing(false);
              }}
              className="text-[11.5px] text-ink-4 hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-4">
            From{" "}
            <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="underline hover:text-accent">
              steamcommunity.com/dev/apikey
            </a>
            . Saved only if Steam accepts it, stored encrypted, and not shown again. It is only for searching:
            links to items and collections work without it.
          </p>
        </form>
      )}
    </div>
  );
}
