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

const nextConfig: NextConfig = {
  /* A second panel beside the first, on one checkout: verify:setup runs
     its own against an empty database while a developer's is up, and two
     servers cannot share a build directory. Nothing else sets this. */
  distDir: process.env.GEEBOARD_DIST_DIR || ".next",

  env: { GEEBOARD_VERSION: version },
};

export default nextConfig;
