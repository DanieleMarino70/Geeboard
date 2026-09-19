"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, RotateCw } from "lucide-react";
import clsx from "clsx";
import { Button, Card } from "@/components/ui";
import { ConfigFieldRow, groupFields } from "@/components/config-field";
import { useToast } from "@/components/toast";
import { updateServerConfig } from "@/app/actions/config";
import type { ConfigField, ConfigValue } from "@/domain/games/types";
import type { ConfigDrift, ConfigPlan } from "@/lib/config-ops";

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

export function GameSettings({
  slug,
  gameName,
  fields,
  initial,
  drift = [],
}: {
  slug: string;
  gameName: string;
  fields: ConfigField[];
  /** What the server has: its files where they could be read, the stored settings otherwise. */
  initial: Record<string, ConfigValue>;
  /** Where the files disagreed with what the panel last wrote. */
  drift?: ConfigDrift[];
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

  const groups = useMemo(() => groupFields(fields, showAdvanced), [fields, showAdvanced]);

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

      {/* The file on the node is what the game reads, so it is what the
          form shows — and says so, because the value here changing on its
          own would otherwise look like the panel losing a setting. */}
      {drift.length > 0 && (
        <div className="mt-3 rounded-[9px] border border-info-line bg-info-soft px-3 py-[11px]">
          <p className="text-[11.5px] leading-relaxed text-info">
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

      {groups.map(([group, rows]) => (
        <section key={group} className="mt-[14px]">
          <h3 className="font-mono text-[9.5px] tracking-[0.06em] text-ink-4 uppercase">{group}</h3>
          <div className="mt-1">
            {rows.map((field) => (
              <ConfigFieldRow
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
