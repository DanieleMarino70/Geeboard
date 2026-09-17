"use client";

import "./globals.css";

/* The last resort: the root layout itself failed. It replaces the whole
   document, so it brings its own <html> and the stylesheet. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-bg px-5 text-ink antialiased">
        <title>Geeboard — error</title>
        <div className="max-w-[46ch] text-center">
          <h1 className="text-[22px] font-semibold">Geeboard could not load</h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            The panel failed before it could draw anything. Try again; if it keeps happening, the
            panel&apos;s log has the reason.
          </p>
          {error.digest && <p className="mt-3 font-mono text-[10.5px] text-ink-4">reference {error.digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 rounded-lg bg-accent px-3 py-[6px] text-xs font-semibold text-accent-ink"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
