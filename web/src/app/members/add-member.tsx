"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import type { Role } from "@prisma/client";
import { createMember } from "@/app/actions/members";
import { SecretReveal } from "@/app/api-keys/key-actions";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";

const FIELD =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-[9px] text-[13px] outline-none transition-colors duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent-line";

/* A new account, from the panel. What comes back is a setup link, shown
   once the way an API key is: the panel sends no email, so the admin
   hands it over themselves — a chat, a note, a phone read aloud. */
export function AddMember({ canMakeOwner }: { canMakeOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  if (link) {
    return (
      <SecretReveal
        secret={link}
        onDone={() => {
          setLink(null);
          setOpen(false);
        }}
      />
    );
  }

  if (!open) {
    return (
      <div className="flex items-start gap-[10px] rounded-[10px] border border-line bg-card px-3 py-[11px]">
        <UserPlus size={14} strokeWidth={1.9} className="mt-px shrink-0 text-ink-4" />
        <span className="min-w-0 flex-1 text-xs leading-snug text-ink-3">
          An account made here gets a one-time setup link to choose its own password. The panel
          sends no email: you hand the link over yourself. It is shown once and works for seven
          days.
        </span>
        <Button size="sm" icon={UserPlus} onClick={() => setOpen(true)}>
          Add a member
        </Button>
      </div>
    );
  }

  return (
    <form
      className="rounded-[10px] border border-line bg-card px-4 py-[14px]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createMember({ name, email, role });
          push(r.ok ? { tone: r.tone, title: r.title, body: r.body } : { tone: "danger", title: r.title, body: r.body });
          if (r.ok && r.link) {
            setLink(r.link);
            setName("");
            setEmail("");
            setRole("MEMBER");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_150px_auto] sm:items-end">
        <label className="block">
          <span className="mb-[6px] block text-xs font-medium">Name</span>
          <input id="new-member-name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nils Berg" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-[6px] block text-xs font-medium">Email</span>
          <input id="new-member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nils@example.com" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-[6px] block text-xs font-medium">Role</span>
          <select id="new-member-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={FIELD}>
            <option value="MEMBER">Member</option>
            <option value="MODERATOR">Moderator</option>
            <option value="ADMIN">Admin</option>
            {canMakeOwner && <option value="OWNER">Owner</option>}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending || !name.trim() || !email.trim()}>
            {pending ? "Adding…" : "Add and get the link"}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] text-ink-4 hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
      {(role === "OWNER" || role === "ADMIN") && (
        <p className="mt-[10px] text-[11px] leading-relaxed text-ink-4">
          Owners and admins must set up two-factor sign-in before they can use the panel; they are
          sent to their account page until they have.
        </p>
      )}
    </form>
  );
}
