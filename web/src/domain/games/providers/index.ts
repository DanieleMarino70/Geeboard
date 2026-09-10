import { registerVersionProvider } from "../versions";
import type { VersionSourceRef } from "../types";
import { githubProvider } from "./github";
import { minecraftProvider } from "./minecraft";
import { steamProvider } from "./steam";

/* Registering the version providers.

   Importing this module is what makes upstream sources available.
   Importing the registry alone gets you the static provider and nothing
   else, which is deliberate: the definitions and the resolver stay
   testable with no network at all, and a caller that wants live version
   data has to say so by importing this. */

let registered = false;

export function registerBuiltInProviders(): void {
  if (registered) return;
  registered = true;

  registerVersionProvider("steam", (ref, options) =>
    steamProvider(ref as Extract<VersionSourceRef, { provider: "steam" }>, options),
  );
  registerVersionProvider("github", (ref, options) =>
    githubProvider(ref as Extract<VersionSourceRef, { provider: "github" }>, options),
  );
  registerVersionProvider("minecraft-launcher", (ref, options) =>
    minecraftProvider(ref as Extract<VersionSourceRef, { provider: "minecraft-launcher" }>, options),
  );
}

export { clearVersionCache } from "./http";
export { steamBranches } from "./steam";
