import Link from "next/link";
import { KeyRound, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Avatar, Badge, Card, Label } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ROLE_BLURB, ROLE_LABEL, ROLE_TONE, getMembers, relativeTime } from "@/lib/queries";
import { RemoveMember, RoleSelect } from "./member-controls";

export const dynamic = "force-dynamic";

const COLS = "minmax(0,1fr) 132px 168px 96px 108px 34px";

export default async function MembersPage() {
  const user = await requireUser();
  const members = await getMembers();

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  const owners = members.filter((m) => m.role === "OWNER").length;

  return (
    <AppShell crumbs={["Ashfold", "Members"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Members</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Who can reach this workspace, and how far. Role changes take effect immediately and are
              recorded in the audit log.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <button
              type="button"
              disabled
              title="Not wired up yet"
              className="inline-flex items-center gap-[7px] rounded-[9px] bg-accent px-4 py-[9px] text-[13px] font-semibold text-accent-ink opacity-45"
            >
              <UserPlus size={14} strokeWidth={1.9} />
              Invite a member
            </button>
          </div>
        </div>

        {!privileged && (
          <div className="flex items-start gap-[10px] rounded-[10px] border border-line bg-card px-3 py-[11px]">
            <ShieldCheck size={14} strokeWidth={1.9} className="mt-px shrink-0 text-ink-4" />
            <span className="text-xs leading-snug text-ink-3">
              You can see who has access, but only owners and admins can change roles.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">People</h2>
              <span className="font-mono text-[10.5px] text-ink-4">
                {members.length} member{members.length === 1 ? "" : "s"} · {owners} owner
                {owners === 1 ? "" : "s"}
              </span>
            </div>

            <div
              className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
              style={{ gridTemplateColumns: COLS }}
            >
              {["Member", "Role", "Servers", "2FA", "Last seen", ""].map((h, i) => (
                <Label key={h || i}>{h}</Label>
              ))}
            </div>

            {members.map((m, i) => {
              const isSelf = m.id === user.id;
              const lastOwner = m.role === "OWNER" && owners <= 1;
              const adminTouchingOwner = user.role === "ADMIN" && m.role === "OWNER";

              const roleLocked = !privileged || isSelf || lastOwner || adminTouchingOwner;
              const roleReason = !privileged
                ? "Only owners and admins can change roles"
                : isSelf
                  ? "Ask another owner to change your own role"
                  : lastOwner
                    ? "A workspace must keep at least one owner"
                    : "Only an owner can change another owner";

              const removeLocked =
                !privileged || isSelf || lastOwner || adminTouchingOwner || m.servers.length > 0;
              const removeReason =
                m.servers.length > 0
                  ? `Transfer ${m.servers.length} server${m.servers.length === 1 ? "" : "s"} first`
                  : roleReason;

              return (
                <div
                  key={m.id}
                  className={`px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[11px] ${
                    i < members.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <div
                    className="grid items-center gap-x-[14px] gap-y-2"
                    style={{ gridTemplateColumns: COLS }}
                  >
                    <div className="flex min-w-0 items-center gap-[11px]">
                      <Avatar initials={m.initials} size={30} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium">{m.name}</span>
                          {isSelf && (
                            <span className="rounded-[4px] bg-card-2 px-[5px] py-px font-mono text-[9px] text-ink-4">
                              you
                            </span>
                          )}
                        </div>
                        <div className="mt-[2px] truncate font-mono text-[10px] text-ink-4">
                          {m.email}
                        </div>
                      </div>
                    </div>

                    <RoleSelect
                      memberId={m.id}
                      role={m.role}
                      disabled={roleLocked}
                      reason={roleReason}
                    />

                    <div className="min-w-0">
                      {m.servers.length === 0 ? (
                        <span className="text-[11.5px] text-ink-4">none</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-2 gap-y-1">
                          {m.servers.slice(0, 2).map((s) => (
                            <Link
                              key={s.id}
                              href={`/servers/${s.slug}`}
                              className="truncate text-[11.5px] text-ink-3 hover:text-accent"
                            >
                              {s.name}
                            </Link>
                          ))}
                          {m.servers.length > 2 && (
                            <span className="font-mono text-[10px] text-ink-4">
                              +{m.servers.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    <div>
                      {m.twoFactor ? (
                        <Badge tone="success">on</Badge>
                      ) : (
                        <Badge tone="warning">off</Badge>
                      )}
                    </div>

                    <span className="font-mono text-[10.5px] text-ink-4">
                      {m.lastSeenAt ? relativeTime(m.lastSeenAt) : "never"}
                    </span>

                    <span className="justify-self-end">
                      <RemoveMember
                        memberId={m.id}
                        name={m.name}
                        disabled={removeLocked}
                        reason={removeReason}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13px] font-semibold">What each role can do</h2>
              {(["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const).map((r) => (
                <div key={r} className="border-b border-line py-[10px] last:border-b-0">
                  <div className="mb-[5px] flex items-center gap-2">
                    <Badge tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Badge>
                    <span className="ml-auto font-mono text-[10px] text-ink-4 tnum">
                      {members.filter((m) => m.role === r).length}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug text-ink-4">{ROLE_BLURB[r]}</p>
                </div>
              ))}
            </Card>

            <Card className="px-5 py-[18px]">
              <h2 className="mb-3 text-[13px] font-semibold">Account security</h2>
              {(
                [
                  [
                    ShieldCheck,
                    "Two-factor",
                    `${members.filter((m) => m.twoFactor).length} of ${members.length} enabled`,
                  ],
                  [
                    KeyRound,
                    "API keys",
                    `${members.reduce((n, m) => n + m.activeKeys, 0)} issued across the workspace`,
                  ],
                  [
                    Mail,
                    "Invites",
                    "Sent by email with a single-use link",
                  ],
                ] as const
              ).map(([Icon, k, v]) => (
                <div key={k} className="flex items-start gap-[10px] border-b border-line py-[10px] last:border-b-0">
                  <Icon size={14} strokeWidth={1.7} className="mt-px shrink-0 text-ink-4" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium">{k}</div>
                    <div className="mt-[2px] text-[11px] text-ink-4">{v}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
