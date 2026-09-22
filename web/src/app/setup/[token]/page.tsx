import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { previewLink } from "@/lib/account-ops";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set your password · Geeboard" };
export const dynamic = "force-dynamic";

/* Where a one-time link lands. Public: the person holding it has no
   account they can sign into yet, or a password they no longer trust.
   Looking at the link does not spend it; submitting the form does. */
export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewLink(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-[10px]">
          <BrandMark size={26} className="shrink-0 text-accent" />
          <span className="text-sm font-semibold tracking-[-0.01em]">Geeboard</span>
        </div>

        {preview ? (
          <>
            <div className="mb-[14px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
              {preview.purpose === "SETUP" ? "new account" : "password reset"}
            </div>
            <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]">
              {preview.purpose === "SETUP" ? `Welcome, ${preview.name.split(" ")[0]}` : "Choose a new password"}
            </h1>
            <p className="mt-3 mb-[26px] text-[13px] leading-relaxed text-ink-3">
              This link is for <span className="font-medium text-ink-2">{preview.email}</span>. Choose
              the password you will sign in with; the link stops working the moment you do.
              {preview.purpose === "RESET" &&
                " Two-factor is switched off by a reset — set it up again from your account page."}
            </p>
            <SetupForm token={token} />
          </>
        ) : (
          <>
            <div className="mb-[14px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
              link
            </div>
            <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em]">
              This link no longer works
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
              It was used, it expired, or a newer one replaced it. Ask whoever runs this panel for
              another from Members.
            </p>
            <p className="mt-6 text-[12px]">
              <Link href="/sign-in" className="text-ink-3 hover:text-ink">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
