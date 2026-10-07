import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/* The panel's version comes from package.json and nowhere else.

   Read here and inlined into the bundle, so a build carries the number
   it was built from — a runtime read would not survive the standalone
   output, which ships its own minimal package.json. */
const { version } = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

/* What every response says about how it may be used, and the one thing it must not say.

   The panel sent none of these, and a framework banner: `X-Powered-By` names Next.js to anyone who asks.

   - nosniff: a file the panel serves is the type it says it is.
   - frame-ancestors and X-Frame-Options: nobody frames the panel, so a page of somebody else's cannot lay a sign-in
     over a button (the old header is for the browsers that do not read the new one). Only that one CSP directive: a
     script policy with nonces is a larger change to a framework that writes inline scripts, and is deferred.
   - Referrer-Policy: what the browser does anyway, stated. It must NOT be no-referrer: with that policy the Fetch
     standard makes the Origin header of every POST `null`, even to the same host, and the panel's own check that a
     request came from its pages (server actions, the terminal routes, the API's cookie guard) would refuse everything.
   - Permissions-Policy: the panel uses none of the powerful features, so none can be used from a page of it.

   HSTS is not here: it is only right for a panel reached at a name over https, which is a fact about the install and not the
   build. src/proxy.ts adds it per request. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  /* A second panel beside the first, on one checkout: verify:setup runs
     its own against an empty database while a developer's is up, and two
     servers cannot share a build directory. Nothing else sets this. */
  distDir: process.env.GEEBOARD_DIST_DIR || ".next",

  env: { GEEBOARD_VERSION: version },
};

export default nextConfig;
