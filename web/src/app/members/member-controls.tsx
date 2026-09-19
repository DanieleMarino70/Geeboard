"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { Check, ChevronDown, KeyRound, UserMinus } from "lucide-react";
import type { Role } from "@prisma/client";
import { changeMemberRole, issueResetLink, removeMember } from "@/app/actions/members";
import { SecretReveal } from "@/app/api-keys/key-actions";
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

/* A new one-time link for somebody else's password. Ending their
   sessions and removing their second factor is part of it, which is why
   it is armed before it fires and shown once when it has. */
export function ResetPassword({
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
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();

  if (disabled) {
    return (
      <span title={reason} className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 opacity-30">
        <KeyRound size={14} strokeWidth={1.7} />
      </span>
    );
  }

  return (
    <>
      {link && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6">
          <div className="w-full max-w-[640px]">
            <SecretReveal secret={link} onDone={() => setLink(null)} />
          </div>
        </div>
      )}
      {armed ? (
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setArmed(false)} className="rounded-md px-2 py-1 text-[10.5px] text-ink-4 hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await issueResetLink(memberId);
                push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
                setArmed(false);
                if (r.ok && r.link) setLink(r.link);
                router.refresh();
              })
            }
            className="rounded-md border border-warning-line bg-warning-soft px-2 py-1 text-[10.5px] font-medium text-warning hover:brightness-110"
          >
            Reset
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Reset ${name}'s password`}
          title={`Reset ${name}'s password: ends their sessions, removes two-factor, gives you a one-time link`}
          onClick={() => setArmed(true)}
          className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-warning-soft hover:text-warning"
        >
          <KeyRound size={14} strokeWidth={1.7} />
        </button>
      )}
    </>
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
