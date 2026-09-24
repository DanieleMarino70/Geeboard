import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
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

export const metadata: Metadata = {
  title: "Geeboard",
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
  return (
    <html
      lang="en"
      data-theme={light ? "light" : undefined}
      className={`${geist.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
