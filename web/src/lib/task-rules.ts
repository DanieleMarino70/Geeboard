import type { ConsoleDialect } from "@/domain/games/types";
import { describeCron, nextRuns, parseCron } from "./cron";

/* What a scheduled task may be. Pure, and imported by both the task form
   and the operation that saves it, so the form's inline errors and the
   server's refusal are the same sentences.

   The scheduler could always run tasks; nothing could create, change or
   delete one. Every task on a panel was either the daily backup that
   creation adds or a row from the sample data. */

export const TASK_KINDS = ["BACKUP", "RESTART", "BROADCAST", "COMMAND", "CLEANUP"] as const;
export type TaskKindId = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABEL: Record<TaskKindId, string> = {
  BACKUP: "Backup",
  RESTART: "Restart",
  BROADCAST: "Broadcast",
  COMMAND: "Console command",
  CLEANUP: "Delete old backups",
};

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
    errors.cron = `Not a schedule: ${(error as Error).message}. Five fields: minute hour day month weekday.`;
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
      const keep = Number(payload);
      if (!/^\d+$/.test(payload) || keep < 1 || keep > 365) {
        errors.payload = "How many of the newest backups to keep: a whole number from 1 to 365.";
      }
      break;
    }
  }
  return errors;
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
          ? `keep ${Number(payload)}`
          : null,
  };
}

/** A task's stored payload as the form edits it. */
export function payloadForForm(kind: TaskKindId, payload: string | null): string {
  if (kind === "CLEANUP") return /\d+/.exec(payload ?? "")?.[0] ?? "7";
  if (kind === "BROADCAST" || kind === "COMMAND") return payload ?? "";
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
