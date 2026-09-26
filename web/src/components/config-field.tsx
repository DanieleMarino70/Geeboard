"use client";

import clsx from "clsx";
import { Badge } from "@/components/ui";
import type { ConfigField, ConfigValue } from "@/domain/games/types";

/* One game setting as a form row.

   Every fact on the row comes from the field: its label, its type, its
   bounds, its help and what a change to it costs. The settings page and
   the creation wizard draw the same row, so a setting looks and behaves
   the same whether it is being chosen for a new server or changed on an
   existing one — with one difference. A setting fixed after creation is
   editable exactly once, while the server is being made, and the wizard
   says so; the settings page shows it and does not let it be edited. */

export const FIELD_INPUT =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

export function ConfigFieldRow({
  field,
  value,
  onChange,
  creating = false,
  readOnly = false,
  hidden = false,
}: {
  field: ConfigField;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  /** The server does not exist yet, so a fixed setting can still be chosen. */
  creating?: boolean;
  /** The reader may not change this server's settings. */
  readOnly?: boolean;
  /* A secret this reader was not given. Drawn as hidden rather than as
     the empty value it arrived as: empty means "no password", which is a
     different thing to tell somebody. */
  hidden?: boolean;
}) {
  const id = `cfg-${field.key}`;
  const locked = readOnly || hidden || (field.fixedAfterCreation === true && !creating);

  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-[7px] border-b border-line py-[14px] last:border-b-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-wrap items-center gap-[7px] text-[12.5px] font-medium">
          {field.label}
          {/* What this change costs, in the same words the save uses. A
              value that is an environment variable or a start argument is
              fixed when the workload is made, so it takes a rebuild
              however often the server is restarted — the badge used to
              say "restart" for those too. */}
          {field.fixedAfterCreation ? (
            <Badge tone="muted">{creating ? "set now, for good" : "set at creation"}</Badge>
          ) : field.target.kind === "env" || field.target.kind === "arg" ? (
            <Badge tone="warning">rebuild</Badge>
          ) : (
            field.restartRequired && <Badge tone="muted">restart</Badge>
          )}
        </label>
        {field.help && (
          <p className="mt-[4px] text-[11px] leading-relaxed text-ink-4">{field.help}</p>
        )}
      </div>

      {/* A fieldset, so one attribute disables whichever control this is. */}
      <fieldset disabled={locked} className="min-w-0 disabled:opacity-60">
        {hidden ? (
          <input
            id={id}
            type="text"
            value=""
            readOnly
            placeholder="Hidden — shown only to whoever can change this server's settings"
            className={FIELD_INPUT}
          />
        ) : field.type === "boolean" ? (
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={value === true}
            onClick={() => onChange(!value)}
            className={clsx(
              "relative h-[22px] w-[38px] rounded-full transition-colors duration-150",
              value ? "bg-accent" : "bg-line-2",
            )}
          >
            <span
              className={clsx(
                "absolute top-[3px] h-4 w-4 rounded-full bg-card transition-[left] duration-150",
                value ? "left-[19px]" : "left-[3px]",
              )}
            />
          </button>
        ) : field.type === "enum" ? (
          <select
            id={id}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD_INPUT}
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.type === "number" ? (
          <input
            id={id}
            type="number"
            value={Number(value)}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(Number(e.target.value))}
            className={clsx(FIELD_INPUT, "tnum")}
          />
        ) : field.type === "text" ? (
          <textarea
            id={id}
            rows={3}
            value={String(value)}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            className={clsx(FIELD_INPUT, "resize-y")}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={String(value)}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD_INPUT}
          />
        )}
      </fieldset>
    </div>
  );
}

/** Fields by their group, in definition order, advanced ones only when asked for. */
export function groupFields(fields: ConfigField[], showAdvanced: boolean): Array<[string, ConfigField[]]> {
  const byGroup = new Map<string, ConfigField[]>();
  for (const field of fields) {
    if (field.advanced && !showAdvanced) continue;
    const name = field.group ?? "General";
    byGroup.set(name, [...(byGroup.get(name) ?? []), field]);
  }
  return [...byGroup.entries()];
}
