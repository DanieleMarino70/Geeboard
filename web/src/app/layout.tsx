import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { FlashToast } from "@/components/flash-toast";
import { ToastProvider } from "@/components/toast";
import { readFlash } from "@/lib/flash";
import { schemaProblem } from "@/lib/schema-state";
import "./globals.css";

/* The two typefaces are files in this repository, not a request to
   Google Fonts. With next/font/google every build and every `next dev`
   fetched the stylesheet and the font files from Google, so the panel
   could not be built without Google answering — and when Google's answer
   changed shape, so did the build: in CI every page answered 500 with
   "next/font/google queries have exactly one entry", while the same
   commit built here. A font URL with a query string of its own in
   Google's stylesheet reproduces exactly that. The documentation site
   already serves these same files from itself; see docs-src/assets/fonts.
   They are copies, because the panel's image is built from web/ alone,
   and test/fonts.test.ts refuses any difference between the two.

   Both are variable fonts, so one file covers every weight the panel
   uses. Geist covers Latin, Latin Extended, Cyrillic and Vietnamese;
   this JetBrains Mono covers Latin-1 only, and a monospace line with a
   letter outside it falls back to the system's monospace for that
   letter. Both are under the SIL Open Font License, beside the files. */
const geist = localFont({
  src: "./fonts/geist-variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

const jetbrains = localFont({
  src: "./fonts/jetbrains-mono-variable.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

/* A title for every page: the browser tab, the history, a bookmark and the route announcement a screen reader hears when a navigation ends
   (Next speaks it only when the title changed, and with one title for every page it never spoke). A page says its own and the template
   adds the name; test/titles.test.ts fails on a page that does not. */
export const metadata: Metadata = {
  title: { default: "Geeboard", template: "%s · Geeboard" },
  description: "Game server management, without the server software getting in the way.",
};

/* The theme comes from a cookie the toggle writes, so the server renders
   the right palette and a light-mode reload never flashes dark.

   It used to be an inline script reading localStorage before first
   paint. React warned about that script every time a page rendered its
   not-found boundary on the client — a missing server's page logged an
   error in the console of every visit.

   The font variables go on <html>, not <body>. The theme defines
   --font-sans on :root as var(--font-geist), and a variable inside a
   variable is resolved where the outer one is defined — on :root — so
   with --font-geist on <body> it resolved to nothing, and every page was
   set in the browser's default sans instead of Geist. The monospace
   never showed it: its utility class reads the variable on the element
   itself. */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const light = (await cookies()).get("gb-theme")?.value === "light";
  /* A database that is not at this release's schema is said so, once, on every
     page, instead of each page failing in its own way at its own query. */
  const problem = await schemaProblem();
  // What an action that redirected had to say (deleting a server: which final backup, what DNS was left), shown once by the page it landed on.
  const flash = await readFlash();
  return (
    <html
      lang="en"
      data-theme={light ? "light" : undefined}
      className={`${geist.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {problem ? (
          <main className="grid min-h-screen place-items-center bg-bg px-5 py-16 text-ink sm:px-8">
            <div className="max-w-[56ch]">
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">The database is not at this release&apos;s schema</h1>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{problem.line}</p>
              <p className="mt-3 rounded-lg border border-line bg-card px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-2">{problem.fix}</p>
              <p className="mt-3 text-[12px] text-ink-4">Nothing is lost by waiting: game servers run on their nodes and keep running. This page checks again every half minute.</p>
            </div>
          </main>
        ) : (
          /* One provider for the whole document, not one per page: a message pushed just before a navigation (a clone that could not
             copy its world, the DNS warning after a create) was destroyed with the page that held it. */
          <ToastProvider>
            <FlashToast flash={flash} />
            {children}
          </ToastProvider>
        )}
      </body>
    </html>
  );
}
