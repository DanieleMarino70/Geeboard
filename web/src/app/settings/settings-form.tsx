"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCw, Save, TriangleAlert, Trash2 } from "lucide-react";
import { deleteServer, saveServerSettings } from "@/app/actions/settings";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";
import {
  PLATFORM_FLOOR,
  limitsForSaved,
  settingsWarnings,
  validateSettings,
  type SettingsErrors,
  type SettingsInput,
  type SettingsLimits,
} from "@/lib/settings-rules";

export interface ServerSettings extends SettingsInput {
  slug: string;
  port: number;
  version: string;
  node: string;
  worldSize: string;
  /** A real workload exists, so new resource limits need a rebuild to apply. */
  rebuildable: boolean;
  /* What deleting would take and what it would leave, so the dialog can
     say it in numbers rather than "every snapshot". */
  deletion: {
    localBackups: number;
    offsiteBackups: number;
    /** Null when a last off-site backup can be taken; otherwise why not. */
    finalBackupBlocked: string | null;
  };
}

/* The platform's own settings for a server: name, address, limits, and
   what happens when it stops.

   Controlled, and saved by calling the action rather than submitting to
   it: a form action resets the form when it finishes, so a save the
   server refused threw away what had been typed. Errors are shown beside
   the field they belong to, as the value is typed, using the same rules
   the save applies. */
export function SettingsForm({ server, limits }: { server: ServerSettings; limits: SettingsLimits }) {
  const initial: SettingsInput = {
    name: server.name,
    host: server.host,
    memoryLimit: server.memoryLimit,
    cpuLimit: server.cpuLimit,
    restartPolicy: server.restartPolicy,
    maxRestarts: server.maxRestarts,
  };
  const [values, setValues] = useState<SettingsInput>(initial);
  const [serverErrors, setServerErrors] = useState<SettingsErrors>({});
  const [saving, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  // The rules the save applies, the saved memory limit included.
  const rules = limitsForSaved(limits, initial.memoryLimit);
  const errors = { ...validateSettings(values, rules), ...serverErrors };
  const valid = Object.keys(validateSettings(values, rules)).length === 0;
  const dirty = (Object.keys(initial) as Array<keyof SettingsInput>).some((k) => initial[k] !== values[k]);
  const limitsChanged = values.memoryLimit !== initial.memoryLimit || values.cpuLimit !== initial.cpuLimit;
  /* Under what the game asks for is allowed, and said. The same words
     the create wizard puts under its sliders. */
  const advice = settingsWarnings(values, limits);
  /* Errors show once a field differs from what was saved, not on a
     pristine form; once anything has changed, every error shows, because
     each one keeps "Save changes" disabled. */
  const show = (k: keyof SettingsInput) => (values[k] !== initial[k] || serverErrors[k] || dirty ? errors[k] : null);

  const set = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => {
    setServerErrors({});
    setValues((v) => ({ ...v, [key]: value }));
  };

  const save = () =>
    start(async () => {
      const result = await saveServerSettings(server.slug, values);
      if (!result.ok) {
        if ("errors" in result && result.errors) setServerErrors(result.errors);
        push({ tone: "danger", title: result.title, body: result.body });
        return;
      }
      push({ tone: result.tone, title: result.title, body: result.body });
      router.refresh();
    });

  const number = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && dirty) save();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Settings</h1>
          <p className="mt-[7px] text-[12.5px] leading-snug text-ink-3">
            {server.name} · every change is recorded in the audit log.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
          {dirty && !saving && (
            <span className="mr-1 flex items-center gap-2 text-[11.5px] text-warning">
              <TriangleAlert size={13} strokeWidth={1.9} />
              Unsaved changes
            </span>
          )}
          <Button intent="ghost" disabled={saving || !dirty} onClick={() => {
            setValues(initial);
            setServerErrors({});
          }}>
            Discard
          </Button>
          <Button type="submit" icon={Save} disabled={saving || !dirty || !valid}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <Card className="p-[22px]">
            <h2 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Identity</h2>
            <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
              How the server appears in this panel and the address you give players. What the game
              itself shows in its server list is in the game&apos;s settings below.
            </p>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <Field label="Server name" htmlFor="s-name" error={show("name")} hint="Shown in the panel.">
                <input
                  id="s-name"
                  value={values.name}
                  maxLength={60}
                  onChange={(e) => set("name", e.target.value)}
                  className={inputClass(Boolean(show("name")))}
                />
              </Field>
              <Field
                label="Address"
                htmlFor="s-host"
                aside={`port ${server.port}`}
                error={show("host")}
                hint="The hostname players connect to. Point its DNS record at the node yourself — Geeboard does not manage DNS."
              >
                <input
                  id="s-host"
                  value={values.host}
                  spellCheck={false}
                  onChange={(e) => set("host", e.target.value)}
                  className={inputClass(Boolean(show("host")), true)}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-[22px]">
            <h2 className="mb-1 text-sm font-semibold tracking-[-0.015em]">Resources</h2>
            <p className="mb-5 text-[11.5px] leading-snug text-ink-4">
              Hard ceilings, not reservations — the server can use up to them and no further. They are
              fixed when the server&apos;s workload is made.
            </p>
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <Field
                label="Memory limit"
                htmlFor="s-memory"
                aside="GB"
                error={show("memoryLimit")}
                hint={`${PLATFORM_FLOOR.memoryGb}–${limits.memoryGb[1]} GB${
                  limits.recommended ? `, ${limits.recommended.memoryGb} asked for by this game` : ""
                }${
                  limits.memoryAvailableGb !== null ? `; ${Math.max(limits.memoryAvailableGb, initial.memoryLimit)} GB available on ${server.node}` : ""
                }.`}
              >
                <input
                  id="s-memory"
                  type="number"
                  inputMode="numeric"
                  min={PLATFORM_FLOOR.memoryGb}
                  max={limits.memoryGb[1]}
                  step={1}
                  value={Number.isNaN(values.memoryLimit) ? "" : values.memoryLimit}
                  onChange={(e) => set("memoryLimit", number(e.target.value))}
                  className={inputClass(Boolean(show("memoryLimit")), true)}
                />
                {!show("memoryLimit") && advice.memoryLimit && <Caution text={advice.memoryLimit} />}
              </Field>
              <Field
                label="CPU limit"
                htmlFor="s-cpu"
                aside="% of a core"
                error={show("cpuLimit")}
                hint={`${PLATFORM_FLOOR.cpuLimit}–${limits.cpuLimit[1]}%${
                  limits.recommended ? `, ${limits.recommended.cpuLimit} asked for by this game` : ""
                }. 200% is two cores.`}
              >
                <input
                  id="s-cpu"
                  type="number"
                  inputMode="numeric"
                  min={PLATFORM_FLOOR.cpuLimit}
                  max={limits.cpuLimit[1]}
                  step={25}
                  value={Number.isNaN(values.cpuLimit) ? "" : values.cpuLimit}
                  onChange={(e) => set("cpuLimit", number(e.target.value))}
                  className={inputClass(Boolean(show("cpuLimit")), true)}
                />
                {!show("cpuLimit") && advice.cpuLimit && <Caution text={advice.cpuLimit} />}
              </Field>
            </div>
            {limitsChanged && server.rebuildable && (
              <p className="mt-4 rounded-[9px] border border-warning-line bg-warning-soft px-3 py-[10px] text-[11.5px] leading-relaxed text-warning">
                New limits take effect when the server is rebuilt — <strong>Rebuild on this version</strong>{" "}
                on{" "}
                <Link href={`/servers/${server.slug}`} className="underline">
                  its page
                </Link>
                . A restart keeps the old ones.
              </p>
            )}
          </Card>

          <Card className="p-[22px]">
            <h2 className="mb-4 text-sm font-semibold tracking-[-0.015em]">When it stops unexpectedly</h2>
            {/* A policy rather than a switch, because "restart it" and "how
                many times before giving up" are different questions and only
                the second one stops a crash loop. */}
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              <Field label="Policy" htmlFor="s-policy" error={show("restartPolicy")}>
                <select
                  id="s-policy"
                  value={values.restartPolicy}
                  onChange={(e) => set("restartPolicy", e.target.value as SettingsInput["restartPolicy"])}
                  className={inputClass(Boolean(show("restartPolicy")))}
                >
                  <option value="NEVER">Leave it down</option>
                  <option value="ON_FAILURE">Restart after a crash</option>
                  <option value="ALWAYS">Restart whenever it stops</option>
                </select>
              </Field>
              <Field
                label="Attempts before giving up"
                htmlFor="s-attempts"
                error={show("maxRestarts")}
                hint="Waits longer between each. The count starts over once a run has lasted."
              >
                <input
                  id="s-attempts"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10}
                  step={1}
                  disabled={values.restartPolicy === "NEVER"}
                  value={Number.isNaN(values.maxRestarts) ? "" : values.maxRestarts}
                  onChange={(e) => set("maxRestarts", number(e.target.value))}
                  className={inputClass(Boolean(show("maxRestarts")), true)}
                />
              </Field>
            </div>
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
              <div key={k} className="flex items-baseline gap-[10px] border-b border-line py-2 last:border-b-0">
                <span className="w-[74px] shrink-0 text-[11.5px] text-ink-4">{k}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{v}</span>
              </div>
            ))}
          </Card>

          <DangerZone slug={server.slug} name={server.name} deletion={server.deletion} />
        </div>
      </div>
    </form>
  );
}

/* Deleting is called rather than submitted.

   This sits inside the settings form, and a form cannot be nested in
   another, so it used to reach a hidden sibling form through the `form`
   attribute. React does not run a form action for a submitter attached
   that way — the browser submits natively, React warns that a form was
   unexpectedly submitted, and the server action never runs. It looked
   like nothing happened, because nothing did. */
function DangerZone({
  slug,
  name,
  deletion,
}: {
  slug: string;
  name: string;
  deletion: ServerSettings["deletion"];
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  /* On when it can be taken: the box is the last chance to keep the
     world, and somebody who does not want it unticks it knowingly. */
  const [finalBackup, setFinalBackup] = useState(deletion.finalBackupBlocked === null);
  const [deleting, startDeleting] = useTransition();
  const { push } = useToast();

  function remove() {
    const data = new FormData();
    data.set("slug", slug);
    data.set("confirmation", confirmation);
    if (finalBackup) data.set("finalBackup", "on");

    startDeleting(async () => {
      // A refusal comes back; a success redirects and never returns.
      const result = await deleteServer(null, data);
      if (result && !result.ok) push({ tone: "danger", title: result.title, body: result.body });
    });
  }

  return (
    // Linked to as #delete from a node being retired.
    <div id="delete" className="scroll-mt-6 rounded-[14px] border border-danger-line bg-card px-5 py-[18px]">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-danger-soft text-danger">
          <TriangleAlert size={13} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold">Danger zone</h2>
      </div>
      <p className="mb-[14px] text-[11.5px] leading-relaxed text-ink-3">
        {`Deleting removes the server from its node, with all world data${
          deletion.localBackups > 0
            ? ` and the ${deletion.localBackups === 1 ? "backup" : `${deletion.localBackups} backups`} on its disk`
            : ""
        }. It cannot be undone.`}
        {deletion.offsiteBackups > 0 &&
          ` ${deletion.offsiteBackups === 1 ? "Its off-site backup stays" : `Its ${deletion.offsiteBackups} off-site backups stay`} in the bucket and on the Backups page, and can be restored into another server of the same game.`}
      </p>

      {!open ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-snug text-ink-4">
            Moving to another node is above. Moving a server to another owner is not supported yet.
          </p>
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
        <div className="flex flex-col gap-[10px]">
          <label className="text-[11.5px] text-ink-3" htmlFor="delete-confirm">
            Type <span className="font-mono text-ink">{name}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={name}
            className={inputClass(false, true)}
          />

          <label
            className={`flex items-start gap-[9px] rounded-[10px] border border-line bg-bg-2 px-3 py-[10px] text-[11.5px] leading-snug ${
              deletion.finalBackupBlocked ? "text-ink-4" : "text-ink-2"
            }`}
          >
            <input
              type="checkbox"
              className="mt-[2px]"
              checked={finalBackup}
              disabled={deleting || deletion.finalBackupBlocked !== null}
              onChange={(e) => setFinalBackup(e.target.checked)}
            />
            <span>
              <span className="font-medium">Take a last backup off-site first.</span>{" "}
              {deletion.finalBackupBlocked ??
                "The world is saved, archived and sent to the bucket before anything is removed, and the backup stays on the Backups page afterwards. If it cannot be taken, nothing is deleted."}
            </span>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmation("");
              }}
              disabled={deleting}
              className="rounded-lg px-3 py-[6px] text-xs text-ink-3 hover:text-ink disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={deleting || confirmation.trim() !== name}
              className="ml-auto inline-flex items-center gap-[7px] rounded-lg border border-danger-line bg-danger-soft px-3 py-[6px] text-xs font-semibold text-danger transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
            >
              <Trash2 size={13} strokeWidth={1.9} />
              {deleting ? (finalBackup ? "Backing up, then deleting…" : "Deleting…") : "Delete permanently"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <RotateCw size={12} strokeWidth={1.9} className="text-ink-4" />
        <span className="text-[10.5px] text-ink-4">Every change here is recorded in the audit log.</span>
      </div>
    </div>
  );
}

/* A value the form will save and thinks you should know about — under
   what the game asks for. Deliberately not an error: the field saves,
   the server is created, and whoever is paying for the machine decides
   how much of it one game gets. */
function Caution({ text }: { text: string }) {
  return (
    <p className="mt-[6px] flex items-start gap-[7px] text-[11px] leading-relaxed text-warning">
      <TriangleAlert size={12} strokeWidth={1.9} className="mt-[2px] shrink-0" />
      <span>{text}</span>
    </p>
  );
}
