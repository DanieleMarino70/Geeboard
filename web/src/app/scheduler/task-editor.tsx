"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createTask, deleteTask, updateTask } from "@/app/actions/tasks";
import { Dialog } from "@/components/dialog";
import { Field, Notice, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import type { ConsoleDialect } from "@/domain/games/types";
import {
  CRON_PRESETS,
  TASK_KINDS,
  TASK_KIND_LABEL,
  payloadForForm,
  previewSchedule,
  validateTask,
  type TaskErrors,
  type TaskInput,
  type TaskKindId,
} from "@/lib/task-rules";

export interface TaskServer {
  slug: string;
  name: string;
  dialect: ConsoleDialect | null;
}

export interface EditableTask {
  id: string;
  serverSlug: string;
  name: string;
  kind: TaskKindId;
  cron: string;
  payload: string | null;
}

const PAYLOAD: Partial<Record<TaskKindId, { label: string; hint: string; placeholder: string; mono?: boolean }>> = {
  BROADCAST: {
    label: "Message",
    hint: "Sent with the game's own broadcast command, so players see it in chat.",
    placeholder: "Restarting in 5 minutes",
  },
  COMMAND: {
    label: "Command",
    hint: "Typed into the server's console as it is. One line.",
    placeholder: "save-all",
    mono: true,
  },
  CLEANUP: {
    label: "Backups to keep",
    hint: "The newest this many stay; older ones are deleted from the node. Locked backups are never touched.",
    placeholder: "7",
    mono: true,
  },
};

/* The form for a new task or a changed one. Checked as it is typed with
   the same rules the server applies, so what it says is what saving
   would say. */
function TaskForm({
  servers,
  task,
  defaultServer,
  onDone,
}: {
  servers: TaskServer[];
  task: EditableTask | null;
  defaultServer: string | null;
  onDone: () => void;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [saving, start] = useTransition();
  const [serverSlug, setServerSlug] = useState(task?.serverSlug ?? defaultServer ?? servers[0]?.slug ?? "");
  const [input, setInput] = useState<TaskInput>({
    name: task?.name ?? "",
    kind: task?.kind ?? "BACKUP",
    cron: task?.cron ?? "0 4 * * *",
    payload: task ? payloadForForm(task.kind, task.payload) : "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<TaskErrors>({});

  const server = servers.find((s) => s.slug === serverSlug);
  const errors = { ...validateTask(input, server?.dialect ?? undefined), ...serverErrors };
  const valid = Object.keys(validateTask(input, server?.dialect ?? undefined)).length === 0 && Boolean(server);
  const preview = useMemo(() => previewSchedule(input.cron), [input.cron]);
  const payload = PAYLOAD[input.kind];

  const set = (patch: Partial<TaskInput>) => {
    setServerErrors({});
    setInput((current) => ({
      ...current,
      ...patch,
      // Switching to a cleanup offers a sensible count rather than an error.
      ...(patch.kind === "CLEANUP" && !/^\d+$/.test(current.payload) ? { payload: "7" } : {}),
    }));
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!valid) return;
    start(async () => {
      const result = task ? await updateTask(task.id, input) : await createTask(serverSlug, input);
      if (!result.ok) {
        // The form stays as typed; only the message changes.
        if (result.errors) setServerErrors(result.errors);
        push({ tone: "danger", title: result.title, body: result.body });
        return;
      }
      push({ tone: result.tone, title: result.title, body: result.body });
      router.refresh();
      onDone();
    });
  };

  const show = (field: keyof TaskInput) => (submitted || serverErrors[field] ? errors[field] : null);

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <Field label="Server" htmlFor="task-server" hint={task ? "A task stays with its server." : undefined}>
        <select
          id="task-server"
          value={serverSlug}
          disabled={Boolean(task)}
          onChange={(e) => setServerSlug(e.target.value)}
          className={inputClass()}
        >
          {servers.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="task-name" error={show("name")}>
          <input
            id="task-name"
            value={input.name}
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Nightly backup"
            className={inputClass(Boolean(show("name")))}
          />
        </Field>
        <Field label="What it does" htmlFor="task-kind" error={show("kind") ?? errors.kind}>
          <select
            id="task-kind"
            value={input.kind}
            onChange={(e) => set({ kind: e.target.value as TaskKindId })}
            className={inputClass(Boolean(errors.kind))}
          >
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {TASK_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {payload && (
        <Field label={payload.label} htmlFor="task-payload" hint={payload.hint} error={show("payload")}>
          <input
            id="task-payload"
            value={input.payload}
            inputMode={input.kind === "CLEANUP" ? "numeric" : undefined}
            maxLength={200}
            onChange={(e) => set({ payload: e.target.value })}
            placeholder={payload.placeholder}
            className={inputClass(Boolean(show("payload")), payload.mono)}
          />
        </Field>
      )}

      <Field
        label="Schedule"
        htmlFor="task-cron"
        error={show("cron")}
        hint={
          preview ? (
            <>
              {preview.description} · next{" "}
              {preview.runs.map((r) => r.toISOString().slice(0, 16).replace("T", " ")).join(", ")} UTC
            </>
          ) : (
            "Five fields, in UTC: minute hour day-of-month month day-of-week."
          )
        }
      >
        <div className="flex flex-wrap gap-[6px]">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => set({ cron: p.cron })}
              aria-pressed={input.cron.trim() === p.cron}
              className={`rounded-md border px-2 py-[3px] text-[11px] transition-colors duration-150 ${
                input.cron.trim() === p.cron
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-line bg-card-2 text-ink-3 hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          id="task-cron"
          value={input.cron}
          onChange={(e) => set({ cron: e.target.value })}
          spellCheck={false}
          placeholder="0 4 * * *"
          className={inputClass(Boolean(show("cron")), true)}
        />
      </Field>

      {input.kind === "RESTART" && (
        <Notice tone="warning">Players are disconnected while it restarts.</Notice>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button intent="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || (submitted && !valid)}>
          {saving ? "Saving…" : task ? "Save task" : "Create task"}
        </Button>
      </div>
    </form>
  );
}

export function NewTaskButton({ servers, defaultServer }: { servers: TaskServer[]; defaultServer: string | null }) {
  const [open, setOpen] = useState(false);
  const none = servers.length === 0;
  return (
    <>
      <Button
        icon={Plus}
        disabled={none}
        title={none ? "Create a server first — a task runs on a server." : undefined}
        onClick={() => setOpen(true)}
      >
        New task
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New task" description="Runs on its server on a schedule, in UTC.">
        <TaskForm servers={servers} task={null} defaultServer={defaultServer} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

export function TaskRowActions({ servers, task }: { servers: TaskServer[]; task: EditableTask }) {
  const { push } = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();

  const remove = () =>
    start(async () => {
      const result = await deleteTask(task.id);
      push(result.ok ? { tone: result.tone, title: result.title, body: result.body } : { tone: "danger", title: result.title, body: result.body });
      setConfirming(false);
      router.refresh();
    });

  const btn = "grid h-[26px] w-[26px] place-items-center rounded-[7px] transition-colors duration-150";

  return (
    <>
      <span className="flex justify-end gap-1">
        <button
          type="button"
          aria-label={`Edit ${task.name}`}
          title="Edit"
          onClick={() => setEditing(true)}
          className={`${btn} text-ink-4 hover:bg-card-2 hover:text-ink`}
        >
          <Pencil size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${task.name}`}
          title="Delete"
          onClick={() => setConfirming(true)}
          className={`${btn} text-ink-4 hover:bg-danger-soft hover:text-danger`}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </span>

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${task.name}`}>
        <TaskForm servers={servers} task={task} defaultServer={null} onDone={() => setEditing(false)} />
      </Dialog>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Delete ${task.name}?`} width={440}>
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          It stops running and is removed. Its past runs stay in the activity log.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button intent="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
          <Button intent="destructive" icon={Trash2} onClick={remove} disabled={busy}>
            {busy ? "Deleting…" : "Delete task"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
