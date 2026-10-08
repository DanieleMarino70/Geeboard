import { bare } from "@/domain/text";
import type { Permission } from "@/domain/access/permissions";
import type { ConsoleDialect } from "@/domain/games/types";
import { describeCron, nextRuns, parseCron } from "./cron";

/* What a scheduled task may be. Pure, and imported by both the task form
   and the operation that saves it, so the form's inline errors and the
   server's refusal are the same sentences.

   The scheduler could always run tasks; nothing could create, change or
   delete one. Every task on a panel was either the daily backup that
   creation adds or a row from the sample data. */

export const TASK_KINDS = ["BACKUP", "RESTART", "BROADCAST", "COMMAND", "CLEANUP", "VERIFY"] as const;
export type TaskKindId = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABEL: Record<TaskKindId, string> = {
  BACKUP: "Backup",
  RESTART: "Restart",
  BROADCAST: "Broadcast",
  COMMAND: "Console command",
  CLEANUP: "Delete old backups",
  VERIFY: "Verify backups",
};

/* What a task does is what somebody could do by hand, and it is allowed to whoever could do that: a key or a role that may schedule things
   but not type in the console must not be able to type in it by scheduling a command and running it, nor delete backups it may not
   delete by scheduling a cleanup. The audit of 0.9.5 found `servers:write` carrying `console:write` and `backups:write` this way. The
   permission is asked in the routes (for the key), in the operations (for the role), and by the scheduler's account when a task fires. */
export const TASK_KIND_PERMISSION: Record<TaskKindId, Permission> = {
  BACKUP: "server.backup.write",
  CLEANUP: "server.backup.write",
  VERIFY: "server.backup.write",
  RESTART: "server.restart",
  BROADCAST: "server.console.write",
  COMMAND: "server.console.write",
};

/** Whether the kind carries text that was typed to a console, which is read only by whoever may watch that console. */
export const TASK_KIND_IS_COMMAND: Record<TaskKindId, boolean> = {
  BACKUP: false,
  CLEANUP: false,
  VERIFY: false,
  RESTART: false,
  BROADCAST: true,
  COMMAND: true,
};

/* What a VERIFY task does with off-site archives. Stored as the payload:
   empty checks they are in the bucket at the size uploaded, "download"
   pulls each one down to the node to re-hash it. */
export const VERIFY_MODES = [
  { value: "", label: "Re-hash archives on the node; check off-site ones are present" },
  { value: "download", label: "Also download off-site archives and re-hash them" },
] as const;

export interface TaskInput {
  name: string;
  kind: TaskKindId;
  cron: string;
  payload: string;
}

export type TaskErrors = Partial<Record<keyof TaskInput, string>>;

/* Tighter than cron allows. A restart or a backup every minute is a
   server that never stays up, or a disk that fills in an afternoon, and
   nobody means either. */
const MIN_GAP_MS = 5 * 60_000;
const MAX_TEXT = 200;

export const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: "Every day at 04:00", cron: "0 4 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Mondays at 04:00", cron: "0 4 * * 1" },
];

/** The error for each field, or an empty object when the task is sound. */
export function validateTask(input: TaskInput, dialect: ConsoleDialect | undefined): TaskErrors {
  const errors: TaskErrors = {};
  const name = input.name.trim();
  if (name.length < 2) errors.name = "Name the task — at least two characters.";
  else if (name.length > 60) errors.name = "Keep the name to 60 characters.";

  if (!TASK_KINDS.includes(input.kind)) errors.kind = "Choose what the task does.";

  const cron = input.cron.trim();
  try {
    parseCron(cron);
    const runs = nextRuns(cron, 12);
    if (runs.length === 0) {
      errors.cron = "This schedule never fires within a year.";
    } else if (runs.some((run, i) => i > 0 && run.getTime() - runs[i - 1]!.getTime() < MIN_GAP_MS)) {
      errors.cron = "Tasks may run at most every five minutes.";
    }
  } catch (error) {
    errors.cron = `Not a schedule: ${bare((error as Error).message)}. Five fields: minute hour day month weekday.`;
  }

  const payload = input.payload.trim();
  switch (input.kind) {
    case "BROADCAST":
      if (!dialect?.broadcastCommand) errors.kind = "This game has no way to broadcast a message.";
      else if (!payload) errors.payload = "Write the message players will see.";
      else if (payload.length > MAX_TEXT) errors.payload = `Keep the message to ${MAX_TEXT} characters.`;
      else if (/[\r\n]/.test(payload)) errors.payload = "One line only.";
      break;
    case "COMMAND":
      if (!dialect?.stopCommand && !(dialect?.examples?.length ?? 0)) {
        errors.kind = "This game has no console language to send a command in.";
      } else if (!payload) errors.payload = "Write the command to send.";
      else if (payload.length > MAX_TEXT) errors.payload = `Keep the command to ${MAX_TEXT} characters.`;
      else if (/[\r\n]/.test(payload)) errors.payload = "One command, on one line.";
      break;
    case "CLEANUP": {
      const keep = cleanupCount(payload);
      if (keep === null || keep < 1 || keep > 365) {
        errors.payload = "How many of the newest backups to keep: a whole number from 1 to 365.";
      }
      break;
    }
    case "VERIFY":
      if (!VERIFY_MODES.some((mode) => mode.value === payload)) {
        errors.payload = "Choose what to do with off-site archives.";
      }
      break;
  }
  return errors;
}

/* How many backups a cleanup keeps, from what it was given: "7" or "keep 7", which are the two forms the docs, the panel's own scheduler and the
   runner all use. The validator took only the bare number, so the documented `keep N` was refused, and a cleanup task made in the panel (stored
   as "keep 14") failed validation the moment an API caller renamed it without sending the payload again. */
export function cleanupCount(payload: string): number | null {
  const match = /^\s*(?:keep\s+)?(\d+)\s*$/i.exec(payload);
  return match ? Number(match[1]) : null;
}

/* What is stored for a sound input: trimmed, with a payload only where
   the kind uses one — a cleanup keeps its count as "keep N", the form the
   scheduler reads. */
export function normaliseTask(input: TaskInput): { name: string; kind: TaskKindId; cron: string; payload: string | null } {
  const payload = input.payload.trim();
  return {
    name: input.name.trim(),
    kind: input.kind,
    cron: input.cron.trim().split(/\s+/).join(" "),
    payload:
      input.kind === "BROADCAST" || input.kind === "COMMAND"
        ? payload
        : input.kind === "CLEANUP"
          ? `keep ${cleanupCount(payload)}`
          : input.kind === "VERIFY" && payload
            ? payload
            : null,
  };
}

/** A task's stored payload as the form edits it. */
export function payloadForForm(kind: TaskKindId, payload: string | null): string {
  if (kind === "CLEANUP") return /\d+/.exec(payload ?? "")?.[0] ?? "7";
  if (kind === "BROADCAST" || kind === "COMMAND") return payload ?? "";
  if (kind === "VERIFY") return /\bdownload\b/i.test(payload ?? "") ? "download" : "";
  return "";
}

/** A sentence and the next runs, for the form's preview. */
export function previewSchedule(cron: string, count = 3): { description: string; runs: Date[] } | null {
  try {
    parseCron(cron.trim());
  } catch {
    return null;
  }
  return { description: describeCron(cron.trim()), runs: nextRuns(cron.trim(), count) };
}
