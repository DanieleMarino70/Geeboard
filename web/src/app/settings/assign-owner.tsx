"use client";

import { useState } from "react";
import { useAction } from "@/components/use-action";
import { useRouter } from "next/navigation";
import { UserRoundCheck } from "lucide-react";
import { assignServer } from "@/app/actions/servers";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";

export interface Assignee {
  id: string;
  name: string;
  role: string;
}

/* Who the server belongs to, and the means to change it. A member sees
   only the servers that are theirs and cannot create one, so this is
   the only way a server reaches them. Owners' and admins'; the page does
   not draw it for anybody else. */
export function AssignOwner({
  slug,
  name,
  owner,
  members,
}: {
  slug: string;
  name: string;
  owner: Assignee;
  members: Assignee[];
}) {
  const [target, setTarget] = useState(owner.id);
  const [pending, start] = useAction();
  const { push } = useToast();
  const router = useRouter();
  const chosen = members.find((m) => m.id === target);
  const changed = target !== owner.id;

  const assign = () =>
    start(async () => {
      const r = await assignServer(slug, target);
      push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
      router.refresh();
    });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <UserRoundCheck size={15} strokeWidth={1.8} className="text-ink-4" />
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">Owner</h2>
      </div>
      <p className="mb-4 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-3">
        {name} is {owner.name}&apos;s. A member sees only the servers that are theirs, and can start,
        stop and watch them; a moderator can also change their settings, files, backups and schedule.
        Owners and admins reach every server whoever it belongs to.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-[320px]">
          <Field label="Give it to" htmlFor="assign-owner">
            <select
              id="assign-owner"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={inputClass()}
              disabled={pending}
            >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role.toLowerCase()}
              </option>
            ))}
            </select>
          </Field>
        </div>
        <Button onClick={assign} disabled={!changed || pending} icon={UserRoundCheck}>
          {pending ? "Assigning…" : chosen && changed ? `Give to ${chosen.name}` : "Give"}
        </Button>
      </div>
    </Card>
  );
}
