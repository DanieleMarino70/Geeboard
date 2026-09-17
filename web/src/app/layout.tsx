import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
   error in the console of every visit. */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const light = (await cookies()).get("gb-theme")?.value === "light";
  return (
    <html lang="en" data-theme={light ? "light" : undefined} suppressHydrationWarning>
      <body className={`${geist.variable} ${jetbrains.variable} antialiased`}>{children}</body>
    </html>
  );
}
