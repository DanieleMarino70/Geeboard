"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { RotateCw, Save, TriangleAlert, Trash2 } from "lucide-react";
import { deleteServer, saveServerSettings, type SettingsState } from "@/app/actions/settings";
import { useToast } from "@/components/toast";
import { Card } from "@/components/ui";

export interface ServerSettings {
  slug: string;
  name: string;
  host: string;
  port: number;
  motd: string;
  javaFlags: string;
  memoryLimit: number;
  cpuLimit: number;
  autosave: boolean;
  whitelist: boolean;
  autoRestart: boolean;
  version: string;
  node: string;
  worldSize: string;
}

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[10px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

function Field({
  label,
  hint,
  children,
  aside,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  aside?: string;
}) {
  return (
    <div>
      <div className="mb-[7px] flex items-baseline gap-2">
        <span className="text-xs font-medium">{label}</span>
        {aside && <span className="ml-auto font-mono text-[10px] text-ink-4">{aside}</span>}
      </div>
      {children}
      {hint && <p className="mt-[7px] text-[11px] leading-snug text-ink-4">{hint}</p>}
    </div>
  );
}

function Toggle({
  name,
  label,
  note,
  defaultChecked,
}: {
  name: string;
  label: string;
  note: string;
  defaultChecked: boolean;
}) {
  const id = useId();
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="flex items-start gap-3 border-b border-line py-[14px] last:border-b-0">
      <input
        id={id}
        type="checkbox"
        name={name}
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="sr-only"
      />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        onClick={() => setOn(!on)}
        className={clsx(
          "mt-px flex h-5 w-9 shrink-0 rounded-full border p-[2px] transition-colors duration-200",
          on ? "justify-end border-accent-line bg-accent" : "justify-start border-line bg-card-2",
        )}
      >
        <span
          className={clsx(
            "h-[14px] w-[14px] rounded-full transition-colors duration-200",
            on ? "bg-accent-ink" : "bg-ink-4",
          )}
        />
      </button>
      <span className="min-w-0 flex-1">
        <span id={`${id}-label`} className="block text-[12.5px] font-medium">
          {label}
        </span>
        <span className="mt-[3px] block text-[11px] leading-snug text-ink-4">{note}</span>
      </span>
    </div>
  );
}

function SaveBar({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex shrink-0 items-center gap-2">
      {dirty && !pending && (
        <span className="mr-1 flex items-center gap-2 text-[11.5px] text-warning">
          <TriangleAlert size={13} strokeWidth={1.9} />
          Unsaved changes
        </span>
      )}
      <button
        type="reset"
        disabled={pending || !dirty}
        className="rounded-[9px] px-4 py-[9px] text-[13px] text-ink-3 transition-colors duration-150 hover:bg-card-2 hover:text-ink disabled:pointer-events-none disabled:opacity-45"
      >
        Discard
      </button>
      <button
        type="submit"
        disabled={pending || !dirty}
        className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink shadow-[0_8px_22px_-14px_var(--accent)] transition-[filter,transform] duration-150 hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-45"
      >
        {pending ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent-ink border-t-transparent" />
        ) : (
          <Save size={14} strokeWidth={1.9} />
        )}
        Save changes
      </button>
    </div>
  );
}

export function SettingsForm({ server }: { server: ServerSettings }) {
  const [state, formAction] = useActionState<SettingsState, FormData>(saveServerSettings, null);
  const [dirty, setDirty] = useState(false);
  const { push } = useToast();
  const router = useRouter();

  /* On a successful save the page revalidates and this component
     remounts under a new key (see settings/page.tsx), which is what
     clears `dirty` — no state reset from inside the effect. */
  useEffect(() => {
    if (!state) return;
    push(
      state.ok
        ? { tone: state.tone, title: state.title, body: state.body }
        : { tone: "danger", title: state.title, body: state.body },
    );
    if (state.ok) router.refresh();
  }, [state, push, router]);

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onReset={() => setDirty(false)}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="slug" value={server.slug} />

      <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Settings</h1>
          <p className="mt-[7px] text-[12.5px] leading-snug text-ink-3">
            {server.name} · changes to startup values apply on the next restart.
          </p>
        </div>
        <div className="lg:ml-auto">
          <SaveBar dirty={dirty} />
        </div>
      </div>

      {state && !state.ok && (
        <div
          role="alert"
          className="flex items-start gap-[10px] rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[11px]"
        >
          <TriangleAlert size={14} strokeWidth={2} className="mt-px shrink-0 text-danger" />
          <span className="text-xs leading-snug text-danger">
            <strong className="font-semibold">{state.title}.</strong> {state.body}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <Card className="p-[22px]">
            <h2 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Identity</h2>
            <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
              How the server introduces itself in the multiplayer list.
            </p>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <Field label="Server name" hint="Shown to players in the server list.">
                <input name="name" defaultValue={server.name} className={FIELD} maxLength={60} />
              </Field>
              <Field label="Subdomain" hint="DNS is managed for you." aside={`port ${server.port}`}>
                <input name="host" defaultValue={server.host} className={`${FIELD} font-mono`} />
              </Field>
            </div>
            <div className="mt-[18px]">
              <Field label="MOTD" hint="Two lines maximum. Colour codes are supported.">
                <input
                  name="motd"
                  defaultValue={server.motd}
                  maxLength={120}
                  placeholder="Aurora SMP — season four"
                  className={FIELD}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-[22px]">
            <h2 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Runtime</h2>
            <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
              Hard ceilings, not reservations — the container can burst up to them and no further.
            </p>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <Field label="Heap ceiling" hint="Between 1 and 64 GB." aside="GB">
                <input
                  name="memoryLimit"
                  type="number"
                  min={1}
                  max={64}
                  defaultValue={server.memoryLimit}
                  className={`${FIELD} font-mono`}
                />
              </Field>
              <Field label="CPU limit" hint="Percent of one core, 50–800." aside="%">
                <input
                  name="cpuLimit"
                  type="number"
                  min={50}
                  max={800}
                  step={25}
                  defaultValue={server.cpuLimit}
                  className={`${FIELD} font-mono`}
                />
              </Field>
            </div>
            <div className="mt-[18px]">
              <Field label="Startup flags" hint={`${server.version} on ${server.node}.`}>
                <div className="flex items-center gap-[9px] rounded-[9px] border border-line bg-bg-2 px-3 py-[10px] focus-within:border-accent-line">
                  <span className="shrink-0 font-mono text-[11px] text-ink-4">java</span>
                  <input
                    name="javaFlags"
                    defaultValue={server.javaFlags}
                    placeholder="-Xms4G -Xmx8G -XX:+UseG1GC"
                    className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-ink-4"
                  />
                </div>
              </Field>
            </div>
          </Card>

          <Card className="p-[22px]">
            <h2 className="mb-4 text-sm font-semibold tracking-[-0.015em]">Behaviour</h2>
            <Toggle
              name="autosave"
              label="Autosave every 5 minutes"
              note="Writes the world to disk without pausing ticks."
              defaultChecked={server.autosave}
            />
            <Toggle
              name="whitelist"
              label="Whitelist only"
              note="Rejects anyone not on the allow list."
              defaultChecked={server.whitelist}
            />
            <Toggle
              name="autoRestart"
              label="Restart automatically after a crash"
              note="Up to three attempts, then it stays down and pages you."
              defaultChecked={server.autoRestart}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="px-5 py-[18px]">
            <h2 className="mb-3 text-[13px] font-semibold">This server</h2>
            {(
              [
                ["Version", server.version],
                ["Node", server.node],
                ["World size", server.worldSize],
                ["Address", `${server.host}:${server.port}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2">
                <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
              </div>
            ))}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
              Heap, CPU, flags and the MOTD are staged on save and picked up on the next restart.
            </p>
          </Card>

          <DangerZone slug={server.slug} name={server.name} />
        </div>
      </div>
    </form>
  );
}

function DangerZone({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SettingsState, FormData>(deleteServer, null);
  const { push } = useToast();

  useEffect(() => {
    if (state && !state.ok) push({ tone: "danger", title: state.title, body: state.body });
  }, [state, push]);

  return (
    <div className="rounded-[14px] border border-danger-line bg-card px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-danger-soft text-danger">
          <TriangleAlert size={13} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold">Danger zone</h2>
      </div>
      <p className="mb-[14px] text-[11.5px] leading-relaxed text-ink-3">
        Deleting removes the container, all world data and every snapshot. It cannot be undone.
      </p>

      {!open ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled
            title="Not wired up yet"
            className="rounded-lg border border-line bg-card px-3 py-[6px] text-xs font-medium text-ink-2 opacity-45"
          >
            Transfer ownership
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-medium text-danger transition-[filter] duration-150 hover:brightness-110"
          >
            <Trash2 size={13} strokeWidth={1.9} />
            Delete this server
          </button>
        </div>
      ) : (
        /* Nested forms are invalid HTML, so this posts to the delete
           action from outside the settings form via formAction. */
        <div className="flex flex-col gap-[10px]">
          <label className="text-[11.5px] text-ink-3" htmlFor="delete-confirm">
            Type <span className="font-mono text-ink">{name}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            name="confirmation"
            form="delete-server-form"
            placeholder={name}
            className={`${FIELD} font-mono`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="delete-server-form"
              className="ml-auto inline-flex items-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-semibold text-danger transition-[filter] duration-150 hover:brightness-110"
            >
              <Trash2 size={13} strokeWidth={1.9} />
              Delete permanently
            </button>
          </div>
        </div>
      )}

      <form id="delete-server-form" action={formAction} className="hidden">
        <input type="hidden" name="slug" value={slug} />
      </form>

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <RotateCw size={12} strokeWidth={1.9} className="text-ink-4" />
        <span className="text-[10.5px] text-ink-4">
          Every change here is recorded in the audit log.
        </span>
      </div>
    </div>
  );
}
