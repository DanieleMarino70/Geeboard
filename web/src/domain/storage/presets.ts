/* What the off-site storage form knows about the stores people use.

   Every one of them speaks S3, and the panel has one client for it
   (domain/storage/s3.ts): there is no second kind of storage, and this is
   not a framework for one. It is a table of what each provider asks for
   that is not obvious — the endpoint's shape, which region to sign with,
   which addressing style — and of what to say when it refuses, because
   those three are where a first save fails. Pure: the form reads it, and so
   does the check that refuses a region the endpoint contradicts.

   Each preset says whether Geeboard has been run against that provider.
   "no" means the entries are from the provider's own documentation and the
   first save is the test; it is said on the form in those words. */

export type StoragePresetId = "amazon" | "backblaze" | "r2" | "other";

export interface StoragePreset {
  id: StoragePresetId;
  label: string;
  /** What the endpoint looks like, for the field's placeholder. */
  endpoint: string;
  /** The region to sign with when it is not in the endpoint; empty where the endpoint says it. */
  region: string;
  pathStyle: boolean;
  /** What is not obvious and bites, one sentence each, from the provider's documentation. */
  notes: string[];
  /** Whether Geeboard has been run against this provider, and against what. */
  tried: { yes: boolean; against: string };
}

export const STORAGE_PRESETS: ReadonlyArray<StoragePreset> = [
  {
    id: "other",
    label: "MinIO, SeaweedFS or another store",
    endpoint: "http://minio:9000",
    region: "us-east-1",
    pathStyle: true,
    notes: ["Most self-hosted stores want path-style addressing and take any region name; the usual one is us-east-1."],
    tried: { yes: true, against: "MinIO, until its image stopped being published, and SeaweedFS 4.48 since" },
  },
  {
    id: "amazon",
    label: "Amazon S3",
    endpoint: "https://s3.<region>.amazonaws.com",
    region: "",
    pathStyle: false,
    notes: [
      "The region is the bucket's own, and the endpoint has to be that region's. Give the key a policy that allows PutObject, GetObject, DeleteObject and ListBucket on this bucket and nothing else, and never an account's root keys.",
    ],
    tried: { yes: false, against: "nothing yet" },
  },
  {
    id: "backblaze",
    label: "Backblaze B2",
    endpoint: "https://s3.<region>.backblazeb2.com",
    region: "",
    pathStyle: false,
    notes: [
      "The endpoint is on the bucket's page in Backblaze, and its second part is the region: s3.eu-central-003.backblazeb2.com is eu-central-003. A region that is not the endpoint's is the usual first failure.",
      "The access key id is the application key's keyID and the secret is its applicationKey, shown once when it is made. Make the key for this bucket alone, with read and write.",
      "A bucket keeps every version of a file by default: a deleted backup stays, hidden, and is billed. Set the bucket's lifecycle to keep only the last version, or deleting an old backup frees nothing.",
    ],
    tried: { yes: false, against: "nothing yet" },
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    endpoint: "https://<account id>.r2.cloudflarestorage.com",
    region: "auto",
    pathStyle: true,
    notes: [
      "The region is auto. Make the API token for this bucket alone, with Object Read & Write.",
    ],
    tried: { yes: false, against: "nothing yet" },
  },
];

const STORE_BY_ID = new Map(STORAGE_PRESETS.map((p) => [p.id, p]));

export function presetFor(id: string): StoragePreset | undefined {
  return STORE_BY_ID.get(id as StoragePresetId);
}

/* The region an endpoint says it is in, for the two providers whose endpoints carry it: s3.eu-west-1.amazonaws.com,
   s3.eu-central-003.backblazeb2.com, and the older dash form, s3-eu-west-1.amazonaws.com. Null for any other host,
   where the panel knows nothing and the person's word stands. */
export function regionFromEndpoint(endpoint: string): string | null {
  let host: string;
  try {
    host = new URL(endpoint.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  const m = /^s3[.-]([a-z0-9-]+)\.(?:amazonaws\.com|backblazeb2\.com)$/.exec(host);
  return m ? m[1]! : null;
}

/* A region the endpoint contradicts is refused before anything is sent: a request is signed for a region, the
   store checks it against its own, and the answer — SignatureDoesNotMatch — says nothing about which part was wrong. */
export function regionProblem(endpoint: string, region: string): string | null {
  const says = regionFromEndpoint(endpoint);
  if (!says || says === region.trim()) return null;
  return `This endpoint is in ${says}, and the region says ${region.trim() || "nothing"}. A request is signed for the region the store is in: use ${says}.`;
}

/** What to add to a store's refusal, by its error code, when it says something a person can act on. */
export function storeAdvice(code: string | undefined): string | null {
  switch (code) {
    case "SignatureDoesNotMatch":
      return "That is usually the region, or the addressing style: the region has to be the store's own, and path-style has to match what it expects. A secret with a stray space does it too.";
    case "RequestTimeTooSkewed":
      return "The store and the panel disagree about the time. Check the clock of the machine the panel runs on.";
    case "InvalidAccessKeyId":
    case "InvalidAccessKey":
      return "The store does not know that access key id. For Backblaze it is the application key's keyID, not the account's.";
    case "AccessDenied":
      return "The key is known but may not do this. It needs to write and delete in this bucket, and to be allowed on it: a key made for another bucket is refused.";
    case "NoSuchBucket":
      return "The store has no bucket by that name at this endpoint. The bucket is made at the store first.";
    default:
      return null;
  }
}
