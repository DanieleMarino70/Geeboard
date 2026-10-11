import type { ConfigField, ConfigValue } from "@/domain/games/types";
import { SETTINGS_LABELS, type SettingsInput } from "./settings-rules";

/* What a change on the Settings page costs, said before it is saved.

   The page has one save for the game's settings and the server's own, and
   a person who changes the MOTD and the CPU limit is told, in the bar that
   saves them, that one is written now and read at the next restart and
   the other needs the server rebuilt. Pure, so the bar, the group headings
   and the rows say it with the same words, and a test holds them to it.

   The costs are the ones the save applies (planConfigChange in
   domain/games/config.ts, and the resource limits in
   updateServerSettingsOp): a value in a file is written at once and read
   when the game next boots, an environment variable or a start argument is
   fixed when the workload is made, and a setting fixed after creation is
   not changed at all. */

export type ChangeCost = "now" | "restart" | "rebuild" | "fixed";

export function fieldCost(field: Pick<ConfigField, "fixedAfterCreation" | "target" | "restartRequired">): ChangeCost {
  if (field.fixedAfterCreation) return "fixed";
  if (field.target.kind === "env" || field.target.kind === "arg") return "rebuild";
  return field.restartRequired ? "restart" : "now";
}

/* The few words a row's badge says when its cost is not its group's. */
export const COST_BADGE: Record<ChangeCost, string> = {
  now: "at once",
  restart: "restart",
  rebuild: "rebuild",
  fixed: "set at creation",
};

function fileOf(field: ConfigField): string | null {
  const target = field.target;
  return "file" in target ? (target.file.split("/").pop() ?? target.file) : null;
}

/* What a group of settings does when it is saved, said once under its heading rather than on every row: the cost most of its settings share,
   and the file they are written to when they share one. A group of Minecraft settings used to carry REBUILD on each of its twelve rows, which
   said nothing a heading could not, and stopped the badge from telling one row from another. */
export function groupNote(fields: ConfigField[]): { cost: ChangeCost; text: string } | null {
  if (fields.length === 0) return null;
  const counts = new Map<ChangeCost, number>();
  for (const field of fields) counts.set(fieldCost(field), (counts.get(fieldCost(field)) ?? 0) + 1);
  // The most common; a tie goes to the dearer one, so a heading never promises less than a row will cost.
  const order: ChangeCost[] = ["rebuild", "restart", "now", "fixed"];
  const cost = order.reduce((best, c) => ((counts.get(c) ?? 0) > (counts.get(best) ?? 0) ? c : best), order.find((c) => counts.has(c))!);

  const files = [...new Set(fields.filter((f) => fieldCost(f) === cost).map(fileOf).filter((f): f is string => f !== null))];
  const where = files.length === 1 ? files[0] : "the server's files";
  const text =
    cost === "rebuild"
      ? "Given to the server when it is made: saving a change rebuilds it around the same world."
      : cost === "restart"
        ? `Written to ${where} when saved; the game reads it at the next restart.`
        : cost === "now"
          ? `Written to ${where} when saved.`
          : "Chosen when the world was created: shown here, and not changed.";
  return { cost, text };
}

/** The badge a row carries: its cost where it differs from its group's, and nothing where the heading already says it. */
export function rowBadge(field: ConfigField, groupCost: ChangeCost | null): ChangeCost | null {
  const cost = fieldCost(field);
  return cost === groupCost ? null : cost;
}

/* ── What is pending ────────────────────────────────────────────── */

export interface PendingChange {
  key: string;
  label: string;
  section: "game" | "server";
  /** As a person reads it: "on", "Survival", "6 GB". A secret is never shown, either side. */
  from: string;
  to: string;
  cost: ChangeCost;
}

const POLICY: Record<string, string> = {
  NEVER: "Leave it down",
  ON_FAILURE: "Restart after a crash",
  ALWAYS: "Restart whenever it stops",
};

/** A game setting's value as the form shows it. */
export function shownValue(field: Pick<ConfigField, "type" | "options" | "secret">, value: ConfigValue | undefined): string {
  if (field.secret) return value === "" || value === undefined ? "not set" : "set";
  if (value === undefined) return "—";
  if (field.type === "boolean") return value ? "on" : "off";
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  const text = String(value);
  return text === "" ? "empty" : text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** One of the server's own settings as the form shows it. */
export function shownServerValue(key: keyof SettingsInput, value: SettingsInput[keyof SettingsInput]): string {
  if (typeof value === "number" && Number.isNaN(value)) return "empty";
  if (key === "memoryLimit") return `${value} GB`;
  if (key === "cpuLimit") return `${value}%`;
  if (key === "restartPolicy") return POLICY[String(value)] ?? String(value);
  return String(value);
}

/** The keys of the server's own settings that differ from what is saved. */
export function changedServerKeys(initial: SettingsInput, values: SettingsInput): Array<keyof SettingsInput> {
  return (Object.keys(initial) as Array<keyof SettingsInput>).filter((k) => !Object.is(initial[k], values[k]));
}

/** The keys of the game's settings that differ from what the server has. */
export function changedGameKeys(fields: ConfigField[], initial: Record<string, ConfigValue>, values: Record<string, ConfigValue>): string[] {
  return [...new Set(fields.map((f) => f.key))].filter((key) => key in values && values[key] !== initial[key]);
}

export function pendingChanges(input: {
  game?: { fields: ConfigField[]; initial: Record<string, ConfigValue>; values: Record<string, ConfigValue> };
  /** `limitsNeedRebuild`: the server has a workload, so new resource limits only reach it when it is made again. */
  server?: { initial: SettingsInput; values: SettingsInput; limitsNeedRebuild: boolean };
}): PendingChange[] {
  const out: PendingChange[] = [];
  if (input.game) {
    const { fields, initial, values } = input.game;
    for (const key of changedGameKeys(fields, initial, values)) {
      const field = fields.find((f) => f.key === key)!;
      // A new password is "a new one": that it changed is said, and nothing about either value.
      const to = field.secret && values[key] !== "" ? "a new one" : shownValue(field, values[key]);
      out.push({ key, label: field.label, section: "game", from: shownValue(field, initial[key]), to, cost: fieldCost(field) });
    }
  }
  if (input.server) {
    const { initial, values, limitsNeedRebuild } = input.server;
    for (const key of changedServerKeys(initial, values)) {
      const limit = key === "memoryLimit" || key === "cpuLimit";
      out.push({
        key,
        label: SETTINGS_LABELS[key],
        section: "server",
        from: shownServerValue(key, initial[key]),
        to: shownServerValue(key, values[key]),
        cost: limit && limitsNeedRebuild ? "rebuild" : "now",
      });
    }
  }
  return out;
}

export interface ChangeSummary {
  count: number;
  restart: number;
  rebuild: number;
  /** A game setting needs the workload made again: the save is refused without one, so the only save offered rebuilds. */
  gameNeedsRebuild: boolean;
  /** "3 changes · 1 applies at the next restart · 1 needs a rebuild" */
  sentence: string;
}

export function summarize(changes: PendingChange[]): ChangeSummary {
  const count = changes.length;
  const restart = changes.filter((c) => c.cost === "restart").length;
  const rebuild = changes.filter((c) => c.cost === "rebuild").length;
  const parts = [`${count} change${count === 1 ? "" : "s"}`];
  if (restart > 0) parts.push(`${restart} ${restart === 1 ? "applies" : "apply"} at the next restart`);
  if (rebuild > 0) parts.push(`${rebuild} ${rebuild === 1 ? "needs" : "need"} a rebuild`);
  return {
    count,
    restart,
    rebuild,
    gameNeedsRebuild: changes.some((c) => c.section === "game" && c.cost === "rebuild"),
    sentence: parts.join(" · "),
  };
}

/* What a rebuild costs, asked before it happens: the words the settings page used for "Rebuild and apply", over every change that needs one. */
export function rebuildSentence(changes: PendingChange[]): string {
  const labels = changes.filter((c) => c.cost === "rebuild").map((c) => c.label);
  const one = labels.length === 1;
  return (
    `${list(labels)} ${one ? "is" : "are"} fixed when the server is created, so applying ${one ? "it" : "them"} means stopping the server and ` +
    "making a new one around the same world. The world, its files and its address are kept; players are disconnected while it happens."
  );
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
