"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Check, ChevronDown, UserMinus } from "lucide-react";
import type { Role } from "@prisma/client";
import { changeMemberRole, removeMember } from "@/app/actions/members";
import { useToast } from "@/components/toast";

const ROLES: Role[] = ["OWNER", "ADMIN", "MODERATOR", "MEMBER"];
const LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  MEMBER: "Member",
};

function useMemberAction() {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const run = (fn: () => Promise<Awaited<ReturnType<typeof removeMember>>>) =>
    startTransition(async () => {
      const r = await fn();
      push(
        r.ok
          ? { tone: r.tone, title: r.title, body: r.body }
          : { tone: "danger", title: r.title, body: r.body },
      );
      router.refresh();
    });

  return { run, pending };
}

export function RoleSelect({
  memberId,
  role,
  disabled,
  reason,
}: {
  memberId: string;
  role: Role;
  disabled: boolean;
  reason?: string;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useMemberAction();

  if (disabled) {
    return (
      <span
        title={reason}
        className="inline-flex cursor-default items-center rounded-full border border-line bg-card-2 px-[10px] py-[4px] font-mono text-[10.5px] text-ink-4"
      >
        {LABEL[role]}
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "inline-flex items-center gap-[6px] rounded-full border border-line bg-card-2 px-[10px] py-[4px] font-mono text-[10.5px] transition-colors duration-150",
          pending ? "opacity-50" : "text-ink-2 hover:border-line-2 hover:text-ink",
        )}
      >
        {LABEL[role]}
        <ChevronDown size={11} strokeWidth={2} />
      </button>

      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <span
            role="listbox"
            className="absolute top-[calc(100%+6px)] left-0 z-50 w-[168px] overflow-hidden rounded-[10px] border border-line-2 bg-surface p-[5px] shadow-e3"
          >
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={r === role}
                onClick={() => {
                  setOpen(false);
                  if (r !== role) run(() => changeMemberRole(memberId, r));
                }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-[7px] px-[10px] py-[7px] text-left text-[12.5px] transition-colors duration-150",
                  r === role ? "text-ink" : "text-ink-2 hover:bg-card-2",
                )}
              >
                <span className="flex-1">{LABEL[r]}</span>
                {r === role && <Check size={12} strokeWidth={2.6} className="text-accent" />}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

export function RemoveMember({
  memberId,
  name,
  disabled,
  reason,
}: {
  memberId: string;
  name: string;
  disabled: boolean;
  reason?: string;
}) {
  const { run, pending } = useMemberAction();
  const [armed, setArmed] = useState(false);

  if (disabled) {
    return (
      <span
        title={reason}
        className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 opacity-30"
      >
        <UserMinus size={14} strokeWidth={1.7} />
      </span>
    );
  }

  return armed ? (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => removeMember(memberId))}
        className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-[10.5px] font-medium text-danger hover:brightness-110"
      >
        Remove
      </button>
    </span>
  ) : (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      title={`Remove ${name}`}
      onClick={() => setArmed(true)}
      className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
    >
      <UserMinus size={14} strokeWidth={1.7} />
    </button>
  );
}
