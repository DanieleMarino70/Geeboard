"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, RotateCw } from "lucide-react";
import clsx from "clsx";
import { Badge, Button, Card } from "@/components/ui";
import { useToast } from "@/components/toast";
import { updateServerConfig } from "@/app/actions/config";
import type { ConfigField, ConfigValue } from "@/domain/games/types";
import type { ConfigPlan } from "@/lib/config-ops";

/* The settings a game actually has.

   Every field on this form comes from the game's definition — its label,
   its type, its bounds, its help text and which group it belongs to.
   There is nothing Minecraft-shaped here, and adding a game adds its
   settings page for free.

   The part worth care is what a change costs. A value in a config file
   can be written to a running server; an environment variable cannot,
   because the environment is fixed when the workload is made. So the
   form works out what would happen and says so before anything is
   saved. A panel that quietly stored an environment change and left the
   server running the old value would be worse than one that refused. */

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

function Row({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
}) {
  const id = `cfg-${field.key}`;

  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-[7px] border-b border-line py-[14px] last:border-b-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-wrap items-center gap-[7px] text-[12.5px] font-medium">
          {field.label}
          {field.restartRequired && <Badge tone="muted">restart</Badge>}
        </label>
        {field.help && (
          <p className="mt-[4px] text-[11px] leading-relaxed text-ink-4">{field.help}</p>
        )}
      </div>

      <div className="min-w-0">
        {field.type === "boolean" ? (
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
            className={FIELD}
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
            className={clsx(FIELD, "tnum")}
          />
        ) : field.type === "text" ? (
          <textarea
            id={id}
            rows={3}
            value={String(value)}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            className={clsx(FIELD, "resize-y")}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={String(value)}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD}
          />
        )}
      </div>
    </div>
  );
}

export function GameSettings({
  slug,
  gameName,
  fields,
  initial,
}: {
  slug: string;
  gameName: string;
  fields: ConfigField[];
  initial: Record<string, ConfigValue>;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [saving, start] = useTransition();
  const [values, setValues] = useState<Record<string, ConfigValue>>(initial);
  const [showAdvanced, setShowAdvanced] = useState(false);
  /* Set when a save was refused because it needs the workload rebuilt.
     Holding it turns the button into a deliberate second act rather than
     a dialog that gets clicked through. */
  const [pendingRecreate, setPendingRecreate] = useState<ConfigPlan | null>(null);

  const dirty = useMemo(
    () => fields.some((f) => values[f.key] !== initial[f.key]),
    [fields, values, initial],
  );

  const groups = useMemo(() => {
    const visible = fields.filter((f) => showAdvanced || !f.advanced);
    const byGroup = new Map<string, ConfigField[]>();
    for (const field of visible) {
      const name = field.group ?? "General";
      byGroup.set(name, [...(byGroup.get(name) ?? []), field]);
    }
    return [...byGroup.entries()];
  }, [fields, showAdvanced]);

  const hasAdvanced = fields.some((f) => f.advanced);

  const save = (recreate: boolean) => {
    start(async () => {
      const result = await updateServerConfig(slug, values, recreate);
      push(
        result.ok
          ? { tone: result.tone, title: result.title, body: result.body }
          : { tone: "danger", title: result.title, body: result.body },
      );

      // A refusal that came with a plan is the "this needs a rebuild"
      // one; anything else is a real failure and should not arm a button.
      setPendingRecreate(!result.ok && result.plan?.needsRecreate ? result.plan : null);
      if (result.ok) router.refresh();
    });
  };

  if (fields.length === 0) {
    return (
      <Card className="px-5 py-[18px]">
        <h2 className="text-[13.5px] font-semibold">{gameName} settings</h2>
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
        <h2 className="text-[13.5px] font-semibold">{gameName} settings</h2>
        {hasAdvanced && (
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-[5px] text-[11.5px] text-ink-3 hover:text-ink-2"
          >
            <ChevronDown
              size={13}
              strokeWidth={2}
              className={clsx("transition-transform duration-150", showAdvanced && "rotate-180")}
            />
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
        )}
      </div>

      {groups.map(([group, groupFields]) => (
        <section key={group} className="mt-[14px]">
          <h3 className="font-mono text-[9.5px] tracking-[0.06em] text-ink-4 uppercase">{group}</h3>
          <div className="mt-1">
            {groupFields.map((field) => (
              <Row
                key={field.key}
                field={field}
                value={values[field.key] ?? field.default}
                onChange={(value) => setValues((v) => ({ ...v, [field.key]: value }))}
              />
            ))}
          </div>
        </section>
      ))}

      {pendingRecreate && (
        <div className="mt-4 rounded-[9px] border border-warning-line bg-warning-soft p-[14px]">
          <div className="mb-[7px] flex items-center gap-[7px]">
            <AlertTriangle size={14} strokeWidth={1.9} className="shrink-0 text-warning" />
            <span className="text-[12.5px] font-medium">This needs the server rebuilt</span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {pendingRecreate.changes
              .filter((c) => c.applies === "on-recreate")
              .map((c) => c.label)
              .join(", ")}{" "}
            {pendingRecreate.changes.filter((c) => c.applies === "on-recreate").length === 1
              ? "is"
              : "are"}{" "}
            fixed when the server is created, so applying{" "}
            {pendingRecreate.changes.filter((c) => c.applies === "on-recreate").length === 1
              ? "it"
              : "them"}{" "}
            means stopping the server and making a new one around the same world. The world, its
            files and its address are kept; players are disconnected while it happens.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button disabled={!dirty || saving} onClick={() => save(false)}>
          Save settings
        </Button>
        {pendingRecreate && (
          <Button
            intent="destructive"
            icon={RotateCw}
            disabled={saving}
            onClick={() => save(true)}
          >
            Rebuild and apply
          </Button>
        )}
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => {
              setValues(initial);
              setPendingRecreate(null);
            }}
            className="text-[11.5px] text-ink-3 hover:text-ink-2"
          >
            Discard
          </button>
        )}
      </div>
    </Card>
  );
}
