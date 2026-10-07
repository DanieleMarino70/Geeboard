"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutTemplate, Trash2 } from "lucide-react";
import { deleteTemplate } from "@/app/actions/templates";
import { LocalTime } from "@/components/local-time";
import { useToast } from "@/components/toast";
import { Badge, Button, Card } from "@/components/ui";
import type { TemplateView } from "@/lib/template-ops";


function Row({ template }: { template: TemplateView }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const remove = () =>
    start(async () => {
      const r = await deleteTemplate(template.id);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      setArmed(false);
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] border border-accent-line bg-accent-soft text-accent">
        <LayoutTemplate size={17} strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="text-[14px] font-semibold tracking-[-0.01em]">{template.name}</span>
          <Badge tone="muted">{template.gameName}</Badge>
          {template.versionLabel && <span className="font-mono text-[11px] text-ink-4">{template.versionLabel}</span>}
          {template.retired && <Badge tone="warning">game no longer offered</Badge>}
        </div>
        <div className="mt-[4px] text-[11.5px] text-ink-3">{template.summary}</div>
        <div className="mt-[3px] text-[11px] text-ink-4">
          {template.sourceName ? `From ${template.sourceName}` : "Saved"}
          {template.createdBy ? ` by ${template.createdBy}` : ""}, <LocalTime at={template.createdAt} style="date" />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {!template.retired && (
          <Link
            href={`/servers/new?template=${encodeURIComponent(template.id)}`}
            className="inline-flex items-center justify-center gap-[7px] rounded-[9px] bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-accent-ink hover:brightness-110"
          >
            Create a server
            <ArrowRight size={13} strokeWidth={1.9} />
          </Link>
        )}
        {armed ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
            >
              Delete {template.name}
            </button>
          </span>
        ) : (
          <Button size="sm" intent="ghost" icon={Trash2} disabled={pending} onClick={() => setArmed(true)}>
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

export function TemplateList({ templates }: { templates: TemplateView[] }) {
  if (templates.length === 0) {
    return (
      <Card className="px-6 py-[48px] text-center">
        <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
          <LayoutTemplate size={20} strokeWidth={1.6} />
        </div>
        <div className="text-[13.5px] font-semibold">No templates yet</div>
        <p className="mx-auto mt-2 max-w-[52ch] text-xs leading-relaxed text-ink-4">
          Set a server up the way you like, then open its{" "}
          <Link href="/settings" className="text-accent hover:underline">
            Settings
          </Link>{" "}
          page and choose Save as a template. Every game also comes with its own, in the create wizard.
        </p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {templates.map((t) => (
          <Row key={t.id} template={t} />
        ))}
      </ul>
    </Card>
  );
}
