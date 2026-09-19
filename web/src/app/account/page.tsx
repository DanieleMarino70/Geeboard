import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Badge, Card } from "@/components/ui";
import { mustEnrol } from "@/domain/access/account";
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
  searchParams: Promise<{ enrol?: string; recovered?: string }>;
}) {
  const user = await requireUser({ allowUnenrolled: true });
  const { enrol, recovered } = await searchParams;
  const overview = await accountOverview(user.id);
  const gated = mustEnrol(user);

  return (
    <AppShell crumbs={["Account"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Your account</h1>
          <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
            {user.name} · {user.email} · {ROLE_LABEL[user.role]}. Every change here is recorded in
            the audit log.
          </p>
        </div>

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

            <Card className="px-5 py-[18px]">
              <h2 className="text-[13.5px] font-semibold">Password</h2>
              <p className="mt-[6px] text-[11.5px] leading-relaxed text-ink-4">
                {overview.passwordSetAt
                  ? `Last set ${relativeTime(overview.passwordSetAt)}.`
                  : "Not yet chosen by you."}{" "}
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
