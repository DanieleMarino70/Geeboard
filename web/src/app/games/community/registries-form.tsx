"use client";

import { useState } from "react";
import { useAction } from "@/components/use-action";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveRegistries } from "@/app/actions/community";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";

/* The owner's list of where an image may come from. Widening it approves nothing: it decides what may be proposed. */

export function RegistriesForm({ registries, defaults, canEdit }: { registries: string[]; defaults: string[]; canEdit: boolean }) {
  const [text, setText] = useState(registries.join("\n"));
  const [pending, start] = useAction();
  const { push } = useToast();
  const router = useRouter();

  const list = text.split(/[\s,]+/).filter(Boolean);
  const changed = list.join() !== registries.join();

  const save = () =>
    start(async () => {
      const result = await saveRegistries(list);
      push({ tone: result.ok ? result.tone : "danger", title: result.title, body: result.body });
      if (result.ok) router.refresh();
    });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-[14px] font-semibold">Where an image may come from</h2>
        <p className="mt-[5px] max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
          A manifest is refused if one of its images is on a registry that is not here. The agent would pull from any; the panel
          is what holds this line. Widening the list approves nothing, and a game already approved keeps the image it was approved with.
        </p>
      </div>
      <Field
        label="Registries"
        htmlFor="registries"
        hint={canEdit ? `One per line. ${defaults.join(" and ")} to start with. A registry you add can serve any image to every node that has agreed to community games.` : "Only an owner can change this list."}
      >
        <textarea
          id="registries"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(3, Math.min(8, list.length + 1))}
          spellCheck={false}
          disabled={!canEdit || pending}
          className={`${inputClass(false, true)} resize-y`}
        />
      </Field>
      {canEdit && (
        <div>
          <Button size="sm" icon={Save} disabled={pending || !changed} onClick={save}>
            {pending ? "Saving…" : "Save the list"}
          </Button>
        </div>
      )}
    </Card>
  );
}
