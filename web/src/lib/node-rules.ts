/* What a person may say about where a node is. Pure, so the Configure
   dialog shows the same errors the operation would return. */

export interface NodeDetailsInput {
  city: string;
  region: string;
}

export type NodeDetailsErrors = Partial<Record<keyof NodeDetailsInput, string>>;

export function validateNodeDetails(input: NodeDetailsInput): NodeDetailsErrors {
  const errors: NodeDetailsErrors = {};
  const city = input.city.trim();
  const region = input.region.trim();
  if (!city) errors.city = "Say where the machine is — a city, a building, a room.";
  else if (city.length > 40) errors.city = "40 characters at most.";
  if (!region) errors.region = "Give it a region, even a made-up one like home.";
  else if (region.length > 32) errors.region = "32 characters at most.";
  // Compared for equality during placement, so it is kept to a plain token.
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(region)) errors.region = "Lower-case letters, digits and hyphens, e.g. eu-west.";
  return errors;
}
