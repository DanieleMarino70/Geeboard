import { PlatformError } from "@/domain/errors";
import { registerNode, type RegistrationRequest } from "@/lib/node-ops";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* POST /api/v1/nodes/register

   The one route a machine calls rather than a person, and the one that
   is not authenticated as a user: the registration token in the body is
   the whole credential, which is why it is short-lived, single-use and
   revocable.

   Everything that arrives here is untrusted input from something holding
   a token. The node lands as PENDING and an admin has to say yes — a
   machine that registered with a leaked token must not become useful by
   waiting. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Partial<RegistrationRequest> | null;
    if (!body) throw new PlatformError("VALIDATION_FAILED", "A JSON body is required.");

    for (const field of ["token", "name", "advertiseUrl", "agentToken"] as const) {
      if (typeof body[field] !== "string" || body[field]!.length === 0) {
        throw new PlatformError("VALIDATION_FAILED", `${field} is required.`);
      }
    }

    const result = await registerNode({
      token: body.token!,
      name: body.name!,
      advertiseUrl: body.advertiseUrl!,
      agentToken: body.agentToken!,
      agentVersion: typeof body.agentVersion === "string" ? body.agentVersion : "unknown",
      os: typeof body.os === "string" ? body.os : "unknown",
      arch: typeof body.arch === "string" ? body.arch : "unknown",
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
      resources: {
        cpuCores: Number(body.resources?.cpuCores ?? 1),
        ramTotalGb: Number(body.resources?.ramTotalGb ?? 1),
        diskTotalGb: Number(body.resources?.diskTotalGb ?? 1),
      },
    });

    return ok(result, 201);
  } catch (error) {
    return fail(error);
  }
}
