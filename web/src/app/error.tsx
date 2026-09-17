"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/* A page that failed to render.

   Without this, an exception while drawing a page — the database down,
   a node answering something unexpected — showed Next's own error screen,
   which in production is a sentence and nothing to do next. The message
   is not repeated here: in production it is a generic one anyway, and the
   digest is what matches the line in the panel's log. */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 py-16 text-ink sm:px-8">
      <div className="max-w-[46ch] text-center">
        <div className="mx-auto mb-5 grid h-11 w-11 place-items-center rounded-[13px] bg-danger-soft text-danger">
          <TriangleAlert size={18} strokeWidth={1.8} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">This page could not be shown</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          Something went wrong while loading it. Trying again usually works if a node or the
          database was briefly unavailable; if it keeps happening, the panel&apos;s log has the reason.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[10.5px] text-ink-4">reference {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex items-center rounded-lg bg-accent px-3 py-[6px] text-xs font-semibold text-accent-ink hover:brightness-110"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-line bg-card px-3 py-[6px] text-xs font-medium text-ink-2 hover:border-line-2 hover:text-ink"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
