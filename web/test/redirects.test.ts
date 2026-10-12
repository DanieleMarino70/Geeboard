import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import nextConfig from "../next.config.ts";

/* /marketplace and /plugins were pages that said "not available yet", and nothing linked to them; /plugins also said Geeboard installs mods
   for Project Zomboid alone, a release after Garry's Mod had them too. They lead where what they were about is now (0.12.0). */

const APP = path.join(import.meta.dirname, "..", "src", "app");

test("/marketplace leads to the games and /plugins to the mods, for good, and to pages that are there", async () => {
  const redirects = (await nextConfig.redirects?.()) ?? [];
  assert.deepEqual(
    redirects.map((r) => ({ source: r.source, destination: r.destination, permanent: "permanent" in r ? r.permanent : undefined })),
    [
      { source: "/marketplace", destination: "/games", permanent: true },
      { source: "/plugins", destination: "/mods", permanent: true },
    ],
  );
  for (const r of redirects) {
    assert.ok(existsSync(path.join(APP, r.destination, "page.tsx")), `${r.destination} has no page`);
    // A redirect is answered before the files are looked at, so a page left at the old address would never be drawn.
    assert.ok(!existsSync(path.join(APP, r.source)), `${r.source} still has a folder of its own`);
  }
});
