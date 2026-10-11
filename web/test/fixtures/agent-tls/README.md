# Test certificates for `agent-tls.test.ts`

Two key and certificate pairs made the way an agent makes its own (`selfSignedCertificate` in `daemon/src/tls.ts`: P-256,
self-signed, not an authority, no end date), so the test can run real TLS servers and check that a pinned call reaches the one
whose fingerprint it was given and sends nothing to the other. **They protect nothing.** The keys are committed on purpose.

| File | What it is |
|---|---|
| `agent.tls.crt`, `agent.tls.key` | the agent the test pins |
| `other.tls.crt`, `other.tls.key` | another key, for "the agent presented a different certificate" |

They are files rather than made by the test because the panel's image is built from `web/` alone, and `next build` checks the
types of `web/test` too: an import from `daemon/` does not resolve there. Nothing in the product reads these files.

Made once, from `daemon/`:

```ts
import { writeFileSync } from "node:fs";
import { selfSignedCertificate } from "./src/tls.ts";
for (const name of ["agent", "other"]) {
  const made = selfSignedCertificate(`${name} (test, protects nothing)`);
  writeFileSync(`${name}.tls.key`, made.key);
  writeFileSync(`${name}.tls.crt`, made.cert);
}
```
