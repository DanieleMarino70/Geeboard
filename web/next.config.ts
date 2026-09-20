import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* A second panel beside the first, on one checkout: verify:setup runs
     its own against an empty database while a developer's is up, and two
     servers cannot share a build directory. Nothing else sets this. */
  distDir: process.env.GEEBOARD_DIST_DIR || ".next",
};

export default nextConfig;
