import { addressFamily } from "@/domain/dns/rules";

/* What a person may say about a node: where it is, and where players
   reach it. Pure, so the Configure dialog shows the same errors the
   operation would return. */

export interface NodeDetailsInput {
  city: string;
  region: string;
  /** An IPv4 or IPv6 literal, or empty to use the address the panel observes. */
  publicAddress: string;
}

export type NodeDetailsErrors = Partial<Record<keyof NodeDetailsInput, string>>;

export function validateNodeDetails(input: NodeDetailsInput): NodeDetailsErrors {
  const errors: NodeDetailsErrors = {};
  const city = input.city.trim();
  const region = input.region.trim();
  const address = (input.publicAddress ?? "").trim();
  if (!city) errors.city = "Say where the machine is — a city, a building, a room.";
  else if (city.length > 40) errors.city = "40 characters at most.";
  if (!region) errors.region = "Give it a region, even a made-up one like home.";
  else if (region.length > 32) errors.region = "32 characters at most.";
  // Compared for equality during placement, so it is kept to a plain token.
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) errors.region = "Lower-case letters, digits and hyphens, e.g. eu-west.";
  if (address && !addressFamily(address)) errors.publicAddress = "An IPv4 or IPv6 address, like 203.0.113.9 — or leave it empty.";
  return errors;
}
