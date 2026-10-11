"use client";

import { useState } from "react";
import clsx from "clsx";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { Notice } from "@/components/form";
import { Badge } from "@/components/ui";
import { noticeApplies } from "@/domain/games/config";
import type { ConfigField, ConfigValue } from "@/domain/games/types";
import { COST_BADGE, fieldCost, rowBadge, type ChangeCost } from "@/lib/settings-summary";

/* What a setting's value means for the people who play on the server, from the definition's own words: under the
   setting while it has that value, and on the server's Overview. */
export function SettingNotice({ field }: { field: ConfigField }) {
  if (!field.notice) return null;
  const { text, link } = field.notice;
  return (
    <Notice tone="info">
      {text.map((paragraph, i) => (
        <p key={i} className={i > 0 ? "mt-[6px]" : undefined}>
          {paragraph}
        </p>
      ))}
      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-[6px] inline-flex items-center gap-[5px] font-medium underline underline-offset-2"
        >
          {link.label}
          <ExternalLink size={12} strokeWidth={1.9} />
        </a>
      )}
    </Notice>
  );
}

/* One game setting as a form row.

   Every fact on the row comes from the field: its label, its type, its
   bounds, its help and what a change to it costs. The settings page and
   the creation wizard draw the same row, so a setting looks and behaves
   the same whether it is being chosen for a new server or changed on an
   existing one — with one difference. A setting fixed after creation is
   editable exactly once, while the server is being made, and the wizard
   says so; the settings page shows it and does not let it be edited. */

export const FIELD_INPUT =
  "w-full rounded-[9px] border border-control bg-bg-2 px-3 py-[9px] text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-accent-line";

export function ConfigFieldRow({
  field,
  value,
  onChange,
  creating = false,
  readOnly = false,
  hidden = false,
  groupCost,
  was,
  error,
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
  /* What the group's heading already says a change costs (lib/settings-summary.ts): the row is badged only where it costs something else.
     Left out, as the wizard does, every row says its own. */
  groupCost?: ChangeCost | null;
  /** The value the server has, as a person reads it, while this one differs from it: the row is marked, and says it on hover and focus. */
  was?: string;
  /** Why the save refused this value, on the field it is about. */
  error?: string | null;
}) {
  const id = `cfg-${field.key}`;
  const locked = readOnly || hidden || (field.fixedAfterCreation === true && !creating);
  const badge = groupCost === undefined ? fieldCost(field) : rowBadge(field, groupCost);
  const describedBy = [was !== undefined ? `${id}-was` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const control = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };
  // An edge you can see, as the panel's other forms draw a field with an error (components/form.tsx).
  const input = clsx(FIELD_INPUT, error && "border-danger-fg!");

  return (
    <div className="group relative grid grid-cols-1 gap-x-5 gap-y-[7px] border-b border-line py-[14px] last:border-b-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      {/* A changed row is marked by a rule at its edge and a dot by its name, and says "changed" to a screen reader in its label. */}
      {was !== undefined && <span aria-hidden className="absolute top-[12px] bottom-[12px] -left-[13px] w-[3px] rounded-full bg-accent" />}
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-wrap items-center gap-[7px] text-[12.5px] font-medium">
          {field.label}
          {was !== undefined && (
            <>
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" />
              <span className="sr-only">(changed)</span>
            </>
          )}
          {/* What this change costs, in the same words the save uses. A
              value that is an environment variable or a start argument is
              fixed when the workload is made, so it takes a rebuild
              however often the server is restarted — the badge used to
              say "restart" for those too. */}
          {badge === "fixed" ? (
            <Badge tone="muted">{creating ? "set now, for good" : COST_BADGE.fixed}</Badge>
          ) : badge === "rebuild" ? (
            <Badge tone="warning">{COST_BADGE.rebuild}</Badge>
          ) : badge === "restart" ? (
            <Badge tone="muted">{COST_BADGE.restart}</Badge>
          ) : (
            badge === "now" && groupCost !== undefined && <Badge tone="muted">{COST_BADGE.now}</Badge>
          )}
        </label>
        {field.help && (
          <p className="mt-[4px] text-[11px] leading-relaxed text-ink-4">{field.help}</p>
        )}
      </div>

      {/* The control, and under it what the save refused and what it was. */}
      <div className="min-w-0">
        {/* A fieldset, so one attribute disables whichever control this is. */}
        <fieldset disabled={locked} className="min-w-0 disabled:opacity-60">
          {hidden ? (
            <input
              {...control}
              type="text"
              value=""
              readOnly
              placeholder="Hidden — shown only to whoever can change this server's settings"
              className={FIELD_INPUT}
            />
          ) : field.type === "boolean" ? (
            <button
              {...control}
              type="button"
              role="switch"
              aria-checked={value === true}
              onClick={() => onChange(!value)}
              className={clsx(
                "relative h-[22px] w-[38px] rounded-full transition-colors duration-150 forced-colors:border forced-colors:border-[ButtonText]",
                value ? "bg-accent" : "bg-control",
              )}
            >
              <span
                className={clsx(
                  "absolute top-[3px] h-4 w-4 rounded-full bg-card transition-[left] duration-150 forced-colors:bg-[ButtonText]",
                  value ? "left-[19px]" : "left-[3px]",
                )}
              />
            </button>
          ) : field.type === "enum" ? (
            <select
              {...control}
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className={input}
            >
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === "number" ? (
            <input
              {...control}
              type="number"
              value={Number(value)}
              min={field.min}
              max={field.max}
              onChange={(e) => onChange(Number(e.target.value))}
              className={clsx(input, "tnum")}
            />
          ) : field.choices ? (
            <ChoiceInput control={control} className={input} field={field} value={String(value)} onChange={onChange} />
          ) : field.type === "text" ? (
            <textarea
              {...control}
              rows={3}
              value={String(value)}
              maxLength={field.maxLength}
              onChange={(e) => onChange(e.target.value)}
              className={clsx(input, "resize-y")}
            />
          ) : (
            <input
              {...control}
              type="text"
              value={String(value)}
              maxLength={field.maxLength}
              onChange={(e) => onChange(e.target.value)}
              className={input}
            />
          )}
        </fieldset>
        {(was !== undefined || error) && (
          <div className="mt-[6px] min-w-0">
            {error && (
              <p id={`${id}-error`} className="flex items-start gap-[5px] text-[11px] leading-snug text-danger-fg">
                <TriangleAlert size={11} strokeWidth={2.2} aria-hidden className="mt-[2px] shrink-0" />
                <span className="min-w-0">{error}</span>
              </p>
            )}
            {/* Kept in its place while hidden, so the rows below do not move as the pointer passes; a screen reader is given it with the field. */}
            {was !== undefined && (
              <p id={`${id}-was`} className="invisible text-[11px] leading-snug text-ink-3 group-focus-within:visible group-hover:visible">
                Was {was}
              </p>
            )}
          </div>
        )}
      </div>
      {/* Outside the fieldset, so a reader who cannot change the setting still reads it undimmed. */}
      {!hidden && noticeApplies(field, value) && (
        <div className="min-w-0 sm:col-start-2">
          <SettingNotice field={field} />
        </div>
      )}
    </div>
  );
}

/* A name chosen from a list, or typed: Garry's Mod's gamemode and map
   (see `ConfigField.choices`). The list is a select, so every name on it
   can be seen at once; "Another name…" opens a text box for one it does
   not have, which is also what a value off the list opens with. A space
   marks that choice, because no name a setting with choices takes can
   hold one. */
const ANOTHER = " another";

function ChoiceInput({
  control,
  className,
  field,
  value,
  onChange,
}: {
  control: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean };
  className: string;
  field: ConfigField;
  value: string;
  onChange: (value: ConfigValue) => void;
}) {
  const listed = field.choices?.values ?? [];
  const [typing, setTyping] = useState(() => !listed.some((choice) => choice.value === value));
  return (
    <div className="flex flex-col gap-[6px]">
      <select
        {...control}
        value={typing ? ANOTHER : value}
        onChange={(e) => {
          setTyping(e.target.value === ANOTHER);
          if (e.target.value !== ANOTHER) onChange(e.target.value);
        }}
        className={className}
      >
        {listed.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.value} — {choice.label}
          </option>
        ))}
        <option value={ANOTHER}>Another name…</option>
      </select>
      {typing && (
        <input
          type="text"
          aria-label={`${field.label}, another name`}
          aria-describedby={control["aria-describedby"]}
          value={value}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          className={className}
        />
      )}
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
