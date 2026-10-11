/* Where a node is, as the pages say it.

   Registration can only guess: it records the agent's hostname as the location and REGION_UNSET as the region (lib/node-ops.ts), and a person
   corrects both with Configure on the node's page. The pages printed the guess as it was stored, so a node approved a minute ago read
   "127.0.0.1 · unknown", and "unknown" beside an address reads like an error. It is a region nobody has set yet, and is said so. The stored
   value stays what it was: placement compares regions, and the API returns it. Pure. */

/** What registration writes before a person has said where a node is. */
export const REGION_UNSET = "unknown";

/** The region a person set, or null for none yet. */
export function regionOf(region: string | null | undefined): string | null {
  const r = (region ?? "").trim();
  return r && r !== REGION_UNSET ? r : null;
}

/** "Falkenstein · eu-central", "127.0.0.1 · region not set", or "location not set" for a node with neither. */
export function locationLine(city: string | null | undefined, region: string | null | undefined): string {
  const place = (city ?? "").trim();
  const set = regionOf(region);
  if (!place && !set) return "location not set";
  return [place, set ?? "region not set"].filter(Boolean).join(" · ");
}
