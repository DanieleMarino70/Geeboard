"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CopyPlus } from "lucide-react";
import { saveTemplate } from "@/app/actions/templates";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";

/* Two ways to reuse a server that is set up well: keep its settings as a template, or
   start a copy of it now. Owners' and admins' — the page does not draw it for anybody
   else. Neither touches the server itself. */
export function CopyServer({ slug, name, canCopyWorld, leftBehind }: { slug: string; name: string; canCopyWorld: boolean; leftBehind: string[] }) {
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const save = () =>
    start(async () => {
      const r = await saveTemplate(slug, label);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      if (r.ok) setLabel("");
      router.refresh();
    });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CopyPlus size={15} strokeWidth={1.8} className="text-ink-4" />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Reuse this server</h2>
      </div>
      <p className="mb-4 max-w-[66ch] text-[12.5px] leading-relaxed text-ink-3">
        Keep {name}&apos;s settings, limits and version as a template for the next server, or start a copy of it now.
        Neither changes {name}.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field
            label="Save as a template"
            htmlFor="template-name"
            hint={
              leftBehind.length > 0
                ? `Not kept: ${leftBehind.join(", ")}, the world, the players, the address and the schedule.`
                : "Not kept: the world, the players, the address and the schedule."
            }
          >
            <input id="template-name" required minLength={2} maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Hardcore weekend" className={inputClass(false)} />
          </Field>
          <div>
            <Button type="submit" size="sm" disabled={pending || label.trim().length < 2}>
              {pending ? "Saving…" : "Save the template"}
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[12px] font-medium text-ink-2">Clone it</div>
            <p className="mt-[6px] text-[11px] leading-snug text-ink-4">
              {canCopyWorld
                ? "Opens the create wizard filled in from this server. At the last step you can copy its world too, through the off-site bucket."
                : "Opens the create wizard filled in from this server. With no off-site bucket the copy gets a new world; the Backups page sets one up."}
            </p>
          </div>
          <div>
            <Link
              href={`/servers/new?clone=${encodeURIComponent(slug)}`}
              className="inline-flex items-center justify-center gap-[7px] rounded-[9px] border border-line bg-card-2 px-3 py-[7px] text-[12.5px] font-semibold hover:border-line-2"
            >
              Clone {name}
              <ArrowRight size={13} strokeWidth={1.9} />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
