"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Card } from "@/components/ui";
import { ConfigFieldRow, groupFields } from "@/components/config-field";
import { settingShown } from "@/domain/games/config";
import type { ConfigField, ConfigValue } from "@/domain/games/types";
import type { ConfigDrift } from "@/lib/config-ops";
import { groupNote, shownValue } from "@/lib/settings-summary";

/* The settings a game actually has.

   Every field on this form comes from the game's definition — its label,
   its type, its bounds, its help text and which group it belongs to.
   There is nothing Minecraft-shaped here, and adding a game adds its
   settings page for free.

   The part worth care is what a change costs. A value in a config file
   can be written to a running server; an environment variable cannot,
   because the environment is fixed when the workload is made. So each
   group says under its heading what saving one of its settings does, a
   row that costs something else says so on itself, and the page's save
   bar adds them up before anything is saved. A panel that quietly stored
   an environment change and left the server running the old value would
   be worse than one that refused.

   It holds no values of its own: the page's one form does (settings-form.tsx), so the game's settings and the server's own are one dirty
   state and one save. */

export function GameSettings({
  gameName,
  fields,
  initial,
  values,
  onChange,
  errors,
  drift = [],
  hidden = [],
  readOnly = false,
}: {
  gameName: string;
  fields: ConfigField[];
  /** What the server has: its files where they could be read, the stored settings otherwise. */
  initial: Record<string, ConfigValue>;
  values: Record<string, ConfigValue>;
  onChange: (key: string, value: ConfigValue) => void;
  /** What is wrong with a value, by key: as it is typed, and what the save refused. */
  errors: Record<string, string>;
  /** Where the files disagreed with what the panel last wrote. */
  drift?: ConfigDrift[];
  /** Secret settings whose values this reader was not given. */
  hidden?: string[];
  /** The reader may see these settings and not change them. */
  readOnly?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  /* A setting for another value of the one it reads (`shownWhen`) is not drawn: the TTT settings on a Sandbox server. Followed as the
     form is changed, so choosing terrortown brings them in before the save. */
  const live = useMemo(() => fields.filter((f) => settingShown({ config: fields }, f, values)), [fields, values]);
  const advanced = live.filter((f) => f.advanced).length;

  /* An advanced setting that has been changed, or has something wrong with it, stays in view when the rest are folded away: a change the
     page is about to save is not one to hide. */
  const groups = useMemo(() => {
    const shown = live.filter((f) => !f.advanced || showAdvanced || values[f.key] !== initial[f.key] || errors[f.key]);
    return groupFields(shown, true).map(([group, rows]) => {
      const note = groupNote(fields.filter((f) => (f.group ?? "General") === group));
      return { group, rows, note };
    });
  }, [live, fields, showAdvanced, values, initial, errors]);

  if (fields.length === 0) {
    return (
      <Card className="px-5 py-[18px]">
        <h3 className="text-[13.5px] font-semibold">{gameName} settings</h3>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-4">
          This game is configured from inside the game rather than from a file, so there is nothing
          to set here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold">{gameName} settings</h3>
        {advanced > 0 && (
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex min-h-8 items-center gap-[6px] rounded-lg border border-line px-3 py-[5px] text-[11.5px] font-medium text-ink-2 hover:border-line-2 hover:text-ink"
          >
            <ChevronDown
              size={13}
              strokeWidth={2}
              className={clsx("transition-transform duration-150", showAdvanced && "rotate-180")}
            />
            {showAdvanced ? "Hide advanced" : `Show ${advanced} advanced`}
          </button>
        )}
      </div>

      {/* The file on the node is what the game reads, so it is what the
          form shows — and says so, because the value here changing on its
          own would otherwise look like the panel losing a setting. */}
      {drift.length > 0 && (
        <div className="mt-3 rounded-[9px] border border-info-line bg-info-soft px-3 py-[11px]">
          <p className="text-[11.5px] leading-relaxed text-info-fg">
            Changed on the server since Geeboard last wrote to it, and shown below as it is now:{" "}
            {drift.map((d, i) => (
              <span key={d.key}>
                {i > 0 && ", "}
                <span className="font-medium">{d.label}</span> {String(d.stored)} → {String(d.onServer)}
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {groups.map(({ group, rows, note }) => (
        <section key={group} aria-labelledby={`cfg-group-${slugOf(group)}`} className="mt-[18px]">
          <h4 id={`cfg-group-${slugOf(group)}`} className="font-mono text-[9.5px] tracking-[0.06em] text-ink-4 uppercase">
            {group}
          </h4>
          {note && <p className="mt-[3px] text-[11px] leading-snug text-ink-3">{note.text}</p>}
          <div className="mt-1">
            {rows.map((field) => (
              <ConfigFieldRow
                key={field.key}
                field={field}
                value={values[field.key] ?? field.default}
                onChange={(value) => onChange(field.key, value)}
                readOnly={readOnly}
                hidden={hidden.includes(field.key)}
                groupCost={note?.cost ?? null}
                was={values[field.key] !== initial[field.key] ? shownValue(field, initial[field.key]) : undefined}
                error={errors[field.key]}
              />
            ))}
          </div>
        </section>
      ))}

      {readOnly && (
        /* Shown, not offered: a save would be refused, and a form that
           looked editable said otherwise only once it was sent. */
        <p className="mt-4 border-t border-line pt-4 text-[11.5px] leading-relaxed text-ink-4">
          Only the server&apos;s owner and admins can change these settings
          {hidden.length > 0 ? ", and only they see its password." : "."}
        </p>
      )}
    </Card>
  );
}

function slugOf(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
