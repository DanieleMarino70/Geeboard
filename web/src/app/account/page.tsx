import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import { shellUser } from "@/lib/ui-types";
import { Badge, Card } from "@/components/ui";
import { accountGate, requiresTwoFactor, temporaryPasswordExpired } from "@/domain/access/account";
import { accountOverview } from "@/lib/account-ops";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL, relativeTime } from "@/lib/queries";
import { PasswordForm, SessionsPanel, TwoFactorPanel } from "./account-panels";

export const dynamic = "force-dynamic";

/* The signed-in person's own account: password, second factor, other
   sessions. The one page an owner who still has to enrol can reach —
   see requireUser — which is why it asks with allowUnenrolled. */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ enrol?: string; recovered?: string; password?: string }>;
}) {
  const user = await requireUser({ allowUnenrolled: true });
  const { enrol, recovered } = await searchParams;
  const overview = await accountOverview(user.id);
  /* What still stands between this person and the panel, in order. The
     two steps are listed whenever either is outstanding, so somebody
     changing a temporary password can see that two-factor comes next
     rather than meeting it as a second surprise. */
  const gate = accountGate(user);
  const gated = gate === "two-factor";
  const expired = temporaryPasswordExpired(user);
  const needsTwoFactor = requiresTwoFactor(user.role);

  return (
    <AppShell crumbs={["Account"]} user={shellUser(user)}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Your account</h1>
          <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
            {user.name} · {user.email} · {ROLE_LABEL[user.role]}. Every change here is recorded in
            the audit log.
          </p>
        </div>

        {gate && (
          <Card className="px-5 py-[18px]">
            <h2 className="text-[13.5px] font-semibold">Before you can use the panel</h2>
            <p className="mt-[6px] max-w-[72ch] text-[11.5px] leading-relaxed text-ink-4">
              You are signed in, and every other page sends you back here until {needsTwoFactor ? "both of these are" : "this is"} done
              — the API refuses this session too. In this order, because a second factor set up behind a
              password somebody else may have seen is not yours.
            </p>
            <ol className="mt-3 flex flex-col gap-2 text-[12px]">
              <li className="flex items-start gap-[9px]">
                <span className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-semibold ${gate === "password" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
                  {gate === "password" ? "1" : "✓"}
                </span>
                <span className={gate === "password" ? "text-ink" : "text-ink-3"}>
                  <strong className="font-semibold">Replace the temporary password</strong>
                  {gate === "password"
                    ? " — below. It was shown once in a terminal and stops working a day after it was made. Choosing your own signs out every other device."
                    : " — done."}
                </span>
              </li>
              {needsTwoFactor && (
                <li className="flex items-start gap-[9px]">
                  <span className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-semibold ${gate === "two-factor" ? "bg-warning-soft text-warning" : "bg-card-2 text-ink-4"}`}>
                    2
                  </span>
                  <span className={gate === "two-factor" ? "text-ink" : "text-ink-4"}>
                    <strong className="font-semibold">Set up two-factor sign-in</strong>
                    {gate === "two-factor" ? " — below. Owners and admins sign in with a second factor." : " — next, once the password is yours."}
                  </span>
                </li>
              )}
            </ol>
            {expired && (
              <p className="mt-3 rounded-[10px] border border-danger-line bg-danger-soft px-3 py-[10px] text-[11.5px] leading-snug text-ink-2">
                <strong className="font-semibold text-danger">The temporary password has expired.</strong> It was good for a
                day and can no longer be exchanged for one of your own. On the machine the panel runs on,{" "}
                <span className="font-mono">npm run admin:recover</span> makes a new one.
              </p>
            )}
          </Card>
        )}

        {gated && (
          <div className="flex items-start gap-[10px] rounded-[10px] border border-warning-line bg-warning-soft px-3 py-[11px]">
            <ShieldAlert size={14} strokeWidth={1.9} className="mt-px shrink-0 text-warning" />
            <span className="text-xs leading-snug text-ink-2">
              {enrol === "required" ? "Before anything else: " : ""}
              {ROLE_LABEL[user.role].toLowerCase() === "owner" ? "Owners" : "Admins"} sign in with a
              second factor. Set it up below; until then the rest of the panel sends you back here.
            </span>
          </div>
        )}

        {recovered === "1" && (
          <div className="flex items-start gap-[10px] rounded-[10px] border border-info-line bg-info-soft px-3 py-[11px]">
            <KeyRound size={14} strokeWidth={1.9} className="mt-px shrink-0 text-info" />
            <span className="text-xs leading-snug text-ink-2">
              You signed in with a recovery code. {overview.recoveryCodesLeft} left — if the
              authenticator is gone for good, regenerate the codes below and set two-factor up again
              on the new phone.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            {/* Not offered while the password is still the temporary one:
                first things first, and the operation refuses it too. */}
            {gate !== "password" && (
            <Card className="px-5 py-[18px]">
              <div className="flex flex-wrap items-center gap-[9px]">
                <h2 className="text-[13.5px] font-semibold">Two-factor sign-in</h2>
                {overview.twoFactor ? (
                  <Badge tone="success">on</Badge>
                ) : (
                  <Badge tone={overview.required ? "warning" : "muted"}>
                    {overview.required ? "required · not set up" : "off"}
                  </Badge>
                )}
              </div>
              <p className="mt-[6px] text-[11.5px] leading-relaxed text-ink-4">
                A six-digit code from an authenticator app after your password. Any app that does
                TOTP works — there is no vendor here. Recovery codes get you in when the phone does
                not.
              </p>
              <TwoFactorPanel
                enabled={overview.twoFactor}
                required={overview.required}
                recoveryCodesLeft={overview.recoveryCodesLeft}
              />
            </Card>
            )}

            <Card className="px-5 py-[18px]">
              <h2 className="text-[13.5px] font-semibold">Password</h2>
              <p className="mt-[6px] text-[11.5px] leading-relaxed text-ink-4">
                {overview.passwordSetAt
                  ? `Last set ${relativeTime(overview.passwordSetAt)}.`
                  : "Still the temporary one: type it as the current password, then one of your own."}{" "}
                Changing it signs out every other device.
              </p>
              <PasswordForm />
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="px-5 py-[18px]">
              <h2 className="mb-2 text-[13px] font-semibold">Sessions</h2>
              <p className="text-[11.5px] leading-relaxed text-ink-4">
                {overview.sessions === 1
                  ? "This is the only device signed in."
                  : `${overview.sessions} devices are signed in, this one included.`}{" "}
                A session lasts two weeks.
              </p>
              <SessionsPanel others={Math.max(0, overview.sessions - 1)} />
            </Card>

            <Card className="px-5 py-[18px]">
              <div className="flex items-start gap-[10px]">
                <ShieldCheck size={14} strokeWidth={1.7} className="mt-px shrink-0 text-ink-4" />
                <div className="min-w-0 text-[11px] leading-relaxed text-ink-4">
                  Owners and admins must use two-factor; everyone else may. An owner or admin can
                  reset your password from Members, which also removes two-factor from the account —
                  the way back in when both the phone and the recovery codes are gone.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
